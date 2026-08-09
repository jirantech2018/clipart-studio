-- Migration: 066_profiles_credits_write_guard_trigger
-- Milestone: M3-3
-- Depends on: 001_profiles, 061_profiles_credits_write_guard_function
-- Plan Ref: docs/01-plan/features/organization-token-management.plan.md v0.2.8 §2.3.3
--
-- 목적:
--   앱 코드가 신규 Credit Service (`use_tokens` / `refund_tokens` /
--   `adjust_tokens` / `allocate_tokens`) 로 완전 전환된 시점에 write guard
--   트리거를 부착한다. 이후 `profiles.credits` 직접 UPDATE 는 RPC 안에서
--   `app.credit_service_active='true'` 세션 변수를 SET 한 경로만 허용된다.
--
-- 안전성:
--   * Legacy wrapper (`reserveCredits` / `refundCredits`) 도 이제 내부적으로
--     `use_tokens` / `adjust_tokens` RPC 를 호출하므로 세션 변수 규약을 통과.
--   * 기존 `reserve_credits` / `refund_credits` RPC (Migration 008, 022) 는
--     여전히 존재하지만 앱에서 호출하지 않는다. 트리거 부착 후 호출되면 예외 발생.
--   * 만약 부착 후 마이그레이션·백필·수동 관리 스크립트가 필요하면 세션에서
--     `SET LOCAL app.credit_service_active = 'true';` 후 UPDATE.
--
-- Rollback:
--   `DROP TRIGGER IF EXISTS profiles_credits_write_guard ON public.profiles;`

DROP TRIGGER IF EXISTS profiles_credits_write_guard ON public.profiles;

CREATE TRIGGER profiles_credits_write_guard
  BEFORE UPDATE OF credits ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_profiles_credits_write_guard();

-- Migration: 061_profiles_credits_write_guard_function
-- Milestone: M1
-- Depends on: 001_profiles
-- Plan Ref: docs/01-plan/features/organization-token-management.plan.md v0.2.1 §6.6
--
-- 목적:
--   `profiles.credits` 는 UI Cache. 직접 UPDATE 는 Credit Service RPC 만
--   허용해야 하지만, M1 단계에서는 아직 앱 코드가 기존 reserve_credits /
--   refund_credits 를 호출하고 있다. 따라서 이 마이그레이션은 **함수만 정의**
--   하고 트리거는 부착하지 않는다.
--
--   M3 (Migration 066) 에서 앱 코드가 신규 Credit Service RPC 로 전환된
--   뒤에 트리거를 부착해 원칙을 완전 활성화한다.
--
-- 트리거 동작 (부착 후):
--   NEW.credits 가 OLD.credits 와 다르면 세션 변수 `app.credit_service_active`
--   = 'true' 인지 확인. 아니면 예외. Credit Service RPC 는 `_credit_sync_profile_cache`
--   에서 이 세션 변수를 SET 하고 UPDATE 를 수행하므로 통과.

CREATE OR REPLACE FUNCTION public.tg_profiles_credits_write_guard()
  RETURNS TRIGGER AS $$
BEGIN
  IF NEW.credits IS DISTINCT FROM OLD.credits THEN
    IF current_setting('app.credit_service_active', TRUE) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'profiles.credits must be updated via Credit Service RPC only';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 부착은 M3 (Migration 066) 에서 명시적으로 수행.
-- 이 마이그레이션은 함수 존재만 보장한다.

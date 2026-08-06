-- Migration: 063_handle_new_user_v2
-- Milestone: M2
-- Depends on: 001_profiles (원본 handle_new_user), 062_provision_my_organization
-- Plan Ref: docs/01-plan/features/organization-token-management.plan.md v0.2.2 §6.8
--
-- 목적:
--   신규 유저 signup 시 profile 만 만들던 기존 트리거를 확장해서 MY
--   Organization + Owner Membership + Token Pool + 초기 Ledger 를 한 트랜잭션
--   으로 생성한다. 실패 시 signup 자체가 롤백된다 (기존과 동일한 원자성).
--
-- 정책:
--   - lazy 생성 없음 (Addendum §MY Organization D-4). signup 즉시 provisioning.
--   - profile 을 먼저 만들고 (기존 로직), profile.credits 가 초기 지급되면
--     그 값을 그대로 MY Pool 로 이관 (`provision_my_organization` 내부에서).
--
-- 하위호환:
--   기존 트리거 이름 (on_auth_user_created) 은 유지. 함수 본문만 교체.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_initial_credits INT;
BEGIN
  v_initial_credits := COALESCE(current_setting('app.initial_credits', TRUE)::INT, 50);

  -- 1. Profile 생성 (기존 로직).
  INSERT INTO public.profiles (id, email, credits, credits_reset_at)
  VALUES (
    NEW.id,
    NEW.email,
    v_initial_credits,
    NOW() + INTERVAL '1 month'
  );

  -- 2. MY Organization + Owner Membership + Token Pool + 초기 Ledger.
  -- provision_my_organization 이 idempotent 이므로 재실행 안전.
  -- 이 호출이 실패하면 signup 전체가 rollback 됨.
  PERFORM public.provision_my_organization(NEW.id);

  RETURN NEW;
END;
$$;

-- 트리거는 이미 존재 (on_auth_user_created) — 함수 본문만 교체됐으므로
-- 별도 CREATE TRIGGER 필요 없음.

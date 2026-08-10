-- Migration: 071_initial_credits_to_20
-- Milestone: Policy tweak
-- Depends on: 001_profiles, 062_provision_my_organization, 063_handle_new_user_v2
--
-- 목적:
--   신규 가입자에게 지급되는 초기 크레딧을 50 → 20 으로 낮춘다.
--
-- 배경:
--   실제 신규 signup 시 흐름:
--     handle_new_user() 트리거
--       → v_initial_credits = COALESCE(GUC 'app.initial_credits', <hardcoded>)
--       → INSERT profiles (credits = v_initial_credits)
--       → provision_my_organization()
--          → allocate_tokens(NULL, my_pool, credits, 'legacy migration')
--            → Ledger ISSUE + Pool.balance = credits
--   즉 handle_new_user 안 fallback 값이 실제 신규 유저 pool.balance 를 결정.
--
-- 두 곳 반영 (원본 파일과 함께):
--   1) profiles.credits 컬럼 default (INSERT 시 credits 를 명시 안 하는
--      다른 경로에서의 fallback)
--   2) handle_new_user() 함수 안 fallback (실제 signup 반영값)
--
-- 기존 유저 잔액은 변경되지 않는다. 다음 신규 signup 부터 20 으로 지급.

ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 20;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_initial_credits INT;
BEGIN
  v_initial_credits := COALESCE(current_setting('app.initial_credits', TRUE)::INT, 20);

  INSERT INTO public.profiles (id, email, credits, credits_reset_at)
  VALUES (
    NEW.id,
    NEW.email,
    v_initial_credits,
    NOW() + INTERVAL '1 month'
  );

  PERFORM public.provision_my_organization(NEW.id);

  RETURN NEW;
END;
$$;

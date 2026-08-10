-- Migration: 072_app_settings
-- Milestone: Admin editable policy
-- Depends on: 001_profiles, 062_provision_my_organization, 063_handle_new_user_v2, 071_initial_credits_to_20
--
-- 목적:
--   신규 가입자 초기 크레딧처럼 "관리자가 웹에서 즉시 바꿔야 하는 정책값"
--   을 담는 key/value 설정 테이블 도입. handle_new_user() 가 이 테이블을
--   실시간으로 읽어 반영.
--
-- 정책:
--   * key='initial_signup_credits' — 신규 가입 시 profiles.credits & MY pool
--     로 지급되는 값. 정수 문자열로 저장.
--   * SELECT / INSERT / UPDATE 는 service_role (admin API 만 접근).
--   * value 는 TEXT 이지만 use-site 에서 캐스팅. 잘못된 값이면 fallback (20).
--
-- 확장:
--   앞으로 다른 정책도 이 테이블에 append (예: 월별 리셋 크기, 기본 aspect 등).

CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 초기 seed
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'initial_signup_credits',
  '20',
  '신규 가입 시 지급되는 초기 크레딧 (profiles.credits & MY pool.balance)'
);

-- RLS: 앱 코드는 오직 service_role 로만 접근.
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
-- 정책 없음 → authenticated / anon 은 SELECT 불가.

-- 이 프로젝트는 "Automatically expose new tables" OFF 라 service_role 도
-- 명시 grant 필요 (Migration 018/070 전례).
GRANT ALL ON public.app_settings TO service_role;

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION public.tg_app_settings_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_settings_updated_at ON public.app_settings;
CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_app_settings_updated_at();

-- handle_new_user 재정의 — app_settings 를 우선 조회.
-- 우선순위:
--   1) GUC 'app.initial_credits' (진단·이관 스크립트용)
--   2) app_settings('initial_signup_credits')
--   3) fallback 20
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_initial_credits INT;
  v_setting TEXT;
BEGIN
  v_setting := current_setting('app.initial_credits', TRUE);
  IF v_setting IS NOT NULL AND v_setting <> '' THEN
    BEGIN
      v_initial_credits := v_setting::INT;
    EXCEPTION WHEN OTHERS THEN
      v_initial_credits := NULL;
    END;
  END IF;

  IF v_initial_credits IS NULL THEN
    SELECT value INTO v_setting FROM public.app_settings
     WHERE key = 'initial_signup_credits' LIMIT 1;
    IF v_setting IS NOT NULL THEN
      BEGIN
        v_initial_credits := v_setting::INT;
      EXCEPTION WHEN OTHERS THEN
        v_initial_credits := NULL;
      END;
    END IF;
  END IF;

  IF v_initial_credits IS NULL OR v_initial_credits < 0 THEN
    v_initial_credits := 20;
  END IF;

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

NOTIFY pgrst, 'reload schema';

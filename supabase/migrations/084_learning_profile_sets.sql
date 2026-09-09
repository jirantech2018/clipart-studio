-- Migration: 084_learning_profile_sets
-- Feature: learning-helper (Phase 1 M2-1.8)
-- Plan Ref: docs/03-analysis/learning-profile-design.md
--
-- 목적:
--   교육과정·버전별로 프로필 세트를 관리. draft → active → archived 상태 전이 지원.
--
-- 적용 이력:
--   2026-09-09 원격 프로덕션에 Studio SQL Editor 수동 실행으로 적용됨.
--   같은 날 supabase migration repair --status applied 084 로 CLI 이력 정합화.

CREATE TABLE IF NOT EXISTS public.learning_profile_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  code TEXT NOT NULL,
  name TEXT NOT NULL,
  curriculum_version TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),

  description TEXT,
  effective_from DATE,
  effective_to DATE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT learning_profile_sets_code_unique UNIQUE (code),
  CONSTRAINT learning_profile_sets_date_range_check CHECK (
    effective_to IS NULL
    OR effective_from IS NULL
    OR effective_from <= effective_to
  )
);

-- RLS: 마스터 데이터. authenticated 는 status='active' 만 SELECT, service_role 은 전권.
ALTER TABLE public.learning_profile_sets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='learning_profile_sets'
      AND policyname='learning_profile_sets_select_active'
  ) THEN
    CREATE POLICY learning_profile_sets_select_active
      ON public.learning_profile_sets
      FOR SELECT
      TO authenticated
      USING (status = 'active');
  END IF;
END $$;

GRANT SELECT ON public.learning_profile_sets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_profile_sets TO service_role;

NOTIFY pgrst, 'reload schema';

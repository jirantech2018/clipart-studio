-- Migration: 085_learning_domains
-- Feature: learning-helper (Phase 1 M2-1.8)
--
-- 적용 이력: 2026-09-09 Studio 수동 실행 → 같은 날 CLI repair 로 이력 정합화.
--
-- 목적:
--   과목 아래 교육 영역 (예: 국어 → 읽기/쓰기/문법, 수학 → 수와 연산/도형).
--   기존 learning_subjects.code 가 TEXT PRIMARY KEY 이므로 subject_code TEXT
--   FK 로 연결 (uuid 아님. 실 스키마 준수).

CREATE TABLE IF NOT EXISTS public.learning_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  subject_code TEXT NOT NULL
    REFERENCES public.learning_subjects(code) ON DELETE RESTRICT,

  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT learning_domains_subject_code_unique
    UNIQUE (subject_code, code)
);

CREATE INDEX IF NOT EXISTS idx_learning_domains_subject
  ON public.learning_domains (subject_code, is_active, sort_order);

-- RLS: 마스터 데이터, is_active=TRUE 만 authenticated SELECT.
ALTER TABLE public.learning_domains ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='learning_domains'
      AND policyname='learning_domains_select_active'
  ) THEN
    CREATE POLICY learning_domains_select_active
      ON public.learning_domains
      FOR SELECT
      TO authenticated
      USING (is_active = TRUE);
  END IF;
END $$;

GRANT SELECT ON public.learning_domains TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_domains TO service_role;

NOTIFY pgrst, 'reload schema';

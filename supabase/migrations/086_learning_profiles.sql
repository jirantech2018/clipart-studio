-- Migration: 086_learning_profiles
-- Feature: learning-helper (Phase 1 M2-1.8)
--
-- 적용 이력: 2026-09-09 Studio 수동 실행 → 같은 날 CLI repair 로 이력 정합화.
--
-- 목적:
--   교육과정 공통 · 학년+과목 · 영역 · 단원 · 예외 수준의 학습 프로필.
--   특정 case (자모, 곱셈 등) 를 프롬프트/검증 코드에 하드코드 대신 데이터로.
--
-- 실 스키마 준수:
--   - subject_code TEXT (learning_subjects.code = TEXT PK)
--   - unit_ref (grade + subject_code + unit_name) 튜플로 매칭.
--     learning_common_topics 는 unit + topic 하이브리드라 uuid FK 부적합.
--     학년+과목+단원명 조합으로 인덱스 조회.
--   - domain_id uuid → learning_domains(id)

CREATE TABLE IF NOT EXISTS public.learning_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  profile_set_id UUID NOT NULL
    REFERENCES public.learning_profile_sets(id) ON DELETE RESTRICT,

  subject_code TEXT
    REFERENCES public.learning_subjects(code) ON DELETE RESTRICT,

  domain_id UUID
    REFERENCES public.learning_domains(id) ON DELETE RESTRICT,

  -- 단원은 uuid FK 가 아니라 (grade + subject_code + unit_name) 튜플 매칭.
  -- learning_common_topics 가 unit+topic 하이브리드라 unit uuid PK 가 없음.
  -- 향후 learning_units 테이블 신설 시 unit_id UUID FK 로 마이그레이션.
  unit_name TEXT,

  scope_type TEXT NOT NULL CHECK (
    scope_type IN ('curriculum', 'grade_subject', 'domain', 'unit', 'exception')
  ),

  grade_min SMALLINT NOT NULL CHECK (grade_min BETWEEN 1 AND 6),
  grade_max SMALLINT NOT NULL CHECK (grade_max BETWEEN 1 AND 6),

  title TEXT NOT NULL,
  description TEXT,

  learning_goals JSONB NOT NULL DEFAULT '[]'::JSONB,
  prerequisites JSONB NOT NULL DEFAULT '[]'::JSONB,

  allowed_scope JSONB NOT NULL DEFAULT '[]'::JSONB,
  excluded_scope JSONB NOT NULL DEFAULT '[]'::JSONB,

  vocabulary_guidance JSONB NOT NULL DEFAULT '{}'::JSONB,
  content_guidance JSONB NOT NULL DEFAULT '{}'::JSONB,

  deterministic_rules JSONB NOT NULL DEFAULT '{}'::JSONB,
  semantic_criteria JSONB NOT NULL DEFAULT '[]'::JSONB,

  priority INTEGER NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),

  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),

  parent_profile_id UUID
    REFERENCES public.learning_profiles(id) ON DELETE RESTRICT,

  change_note TEXT,

  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT learning_profiles_grade_range_check CHECK (grade_min <= grade_max),

  CONSTRAINT learning_profiles_scope_reference_check CHECK (
    (scope_type = 'curriculum'
      AND subject_code IS NULL AND domain_id IS NULL AND unit_name IS NULL)
    OR (scope_type = 'grade_subject'
      AND subject_code IS NOT NULL AND domain_id IS NULL AND unit_name IS NULL)
    OR (scope_type = 'domain'
      AND subject_code IS NOT NULL AND domain_id IS NOT NULL AND unit_name IS NULL)
    OR (scope_type IN ('unit', 'exception')
      AND subject_code IS NOT NULL AND unit_name IS NOT NULL)
  )
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_learning_profiles_resolve
  ON public.learning_profiles (
    profile_set_id, subject_code, grade_min, grade_max, status, priority DESC
  );

CREATE INDEX IF NOT EXISTS idx_learning_profiles_domain
  ON public.learning_profiles (domain_id) WHERE domain_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learning_profiles_unit
  ON public.learning_profiles (subject_code, grade_min, unit_name)
  WHERE unit_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learning_profiles_parent
  ON public.learning_profiles (parent_profile_id)
  WHERE parent_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learning_profiles_deterministic_rules
  ON public.learning_profiles USING GIN (deterministic_rules);

CREATE INDEX IF NOT EXISTS idx_learning_profiles_semantic_criteria
  ON public.learning_profiles USING GIN (semantic_criteria);

-- 중복 방지: 같은 scope + 같은 버전 조합 unique.
-- Postgres 15+ NULLS NOT DISTINCT 사용 (subject_code / domain_id / unit_name 이 NULL 인 curriculum 스코프도 unique 판단).
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_profiles_scope_version_unique
  ON public.learning_profiles (
    profile_set_id, scope_type, subject_code, domain_id, unit_name,
    grade_min, grade_max, version
  ) NULLS NOT DISTINCT;

-- RLS: authenticated 는 active 인 것만, service_role 은 전권.
ALTER TABLE public.learning_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='learning_profiles'
      AND policyname='learning_profiles_select_active'
  ) THEN
    CREATE POLICY learning_profiles_select_active
      ON public.learning_profiles
      FOR SELECT
      TO authenticated
      USING (
        status = 'active'
        AND EXISTS (
          SELECT 1 FROM public.learning_profile_sets ps
          WHERE ps.id = learning_profiles.profile_set_id
            AND ps.status = 'active'
        )
      );
  END IF;
END $$;

GRANT SELECT ON public.learning_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_profiles TO service_role;

NOTIFY pgrst, 'reload schema';

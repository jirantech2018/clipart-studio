-- Migration: 078_learning_subjects
-- Feature: learning-helper (Phase 1 M1)
-- Plan Ref: docs/01-plan/features/learning-helper.plan.md v0.4 §M1
--
-- 목적:
--   초등 학습지 자료의 과목 마스터 테이블. M1 은 국어·수학 2행만 seed 하고,
--   나머지 사회/도덕/과학/실과/체육/음악/미술/영어/통합/창체는 M2 이후 확장.
--
-- 정책:
--   - code 는 상위 렌더러 스키마의 subject enum (KOR, MATH, INT, SOC, ...) 과 일치
--   - active=TRUE 인 행만 UI 에 노출
--   - 조직 무관 글로벌 마스터. 조직별 커스터마이즈는 Phase 2+
--   - RLS 없이 anon/authenticated 모두 SELECT 허용 (마스터 데이터)

CREATE TABLE IF NOT EXISTS public.learning_subjects (
  code TEXT PRIMARY KEY,
  name_ko TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.learning_subjects (code, name_ko, display_order, active) VALUES
  ('KOR', '국어', 1, TRUE),
  ('MATH', '수학', 2, TRUE)
ON CONFLICT (code) DO NOTHING;

-- 마스터 데이터 SELECT 허용 (RLS 미적용).
GRANT SELECT ON public.learning_subjects TO anon, authenticated;
-- server-side API 는 service role client 로 조회하므로 service_role 에도 SELECT.
GRANT SELECT ON public.learning_subjects TO service_role;

NOTIFY pgrst, 'reload schema';

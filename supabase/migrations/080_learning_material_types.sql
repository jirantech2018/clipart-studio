-- Migration: 080_learning_material_types
-- Feature: learning-helper (Phase 1 M1)
-- Plan Ref: docs/01-plan/features/learning-helper.plan.md v0.4 §M1
--
-- 목적:
--   자료 유형 마스터. M1 UI 는 5종 중 객관식·개별활동지 강조 노출, 나머지 3종도
--   선택 가능. Phase 2 에서 15종 확장.
--
-- 정책:
--   - default_format: §2.4 매트릭스 기반. 모두 학생 배포용 → PDF 기본
--   - M1 UI 는 이 5종만 노출

CREATE TABLE IF NOT EXISTS public.learning_material_types (
  code TEXT PRIMARY KEY,
  name_ko TEXT NOT NULL,
  description TEXT NOT NULL,
  default_format TEXT NOT NULL CHECK (default_format IN ('pdf', 'docx', 'pptx')),
  display_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.learning_material_types (code, name_ko, description, default_format, display_order) VALUES
  ('multiple_choice',     '객관식',       '4지선다 객관식 문제. 낱말·개념 확인에 적합', 'pdf', 1),
  ('individual_activity', '개별 활동지',  '학생 개별 활동 워크시트. 활동 절차 안내',   'pdf', 2),
  ('ox_quiz',             'OX 퀴즈',      '참/거짓 판단 문제. 개념 빠른 확인',          'pdf', 3),
  ('concept_summary',     '개념 정리',    '학습 내용 핵심 정리 자료',                    'pdf', 4),
  ('reading_material',    '읽기 자료',    '학년 수준에 맞춘 짧은 읽기 자료',            'pdf', 5)
ON CONFLICT (code) DO NOTHING;

GRANT SELECT ON public.learning_material_types TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

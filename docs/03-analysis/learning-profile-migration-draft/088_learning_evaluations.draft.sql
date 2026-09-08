-- DRAFT — 원격 apply 금지.
--
-- Migration draft: 088_learning_evaluations
-- Feature: learning-helper (Phase 1 M2-1.8)
--
-- 목적:
--   각 학습자료 문서의 3계층 검증 결과 저장 (structure / deterministic /
--   semantic / final). 프로필 snapshot 도 함께 저장해 향후 프로필 개정에도
--   당시 판정 근거 재확인 가능.
--
-- RLS: 자기 문서에 연결된 평가만 사용자 SELECT. 기존 learning_documents
-- RLS 정책 (조직 활성 멤버) 을 재사용하는 서브쿼리.

CREATE TABLE IF NOT EXISTS public.learning_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  document_id UUID NOT NULL
    REFERENCES public.learning_documents(id) ON DELETE CASCADE,

  profile_id UUID
    REFERENCES public.learning_profiles(id) ON DELETE SET NULL,

  evaluation_stage TEXT NOT NULL
    CHECK (evaluation_stage IN ('structure', 'deterministic', 'semantic', 'final')),

  attempt SMALLINT NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 2),

  passed BOOLEAN NOT NULL,
  summary TEXT,

  evaluator_type TEXT NOT NULL CHECK (evaluator_type IN ('code', 'ai', 'hybrid')),
  evaluator_model TEXT,

  profile_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  result JSONB NOT NULL DEFAULT '{}'::JSONB,

  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_evaluations_document
  ON public.learning_evaluations (document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_evaluations_failed
  ON public.learning_evaluations (document_id, evaluation_stage)
  WHERE passed = FALSE;

ALTER TABLE public.learning_evaluations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- 사용자는 자기 문서 (learning_documents 정책이 이미 조직 멤버 필터) 의 평가만 조회.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='learning_evaluations'
      AND policyname='learning_evaluations_select_via_document'
  ) THEN
    CREATE POLICY learning_evaluations_select_via_document
      ON public.learning_evaluations
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.learning_documents d
          WHERE d.id = learning_evaluations.document_id
            AND public.is_org_member(d.organization_id, (SELECT auth.uid()))
        )
      );
  END IF;
END $$;

GRANT SELECT ON public.learning_evaluations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_evaluations TO service_role;

NOTIFY pgrst, 'reload schema';

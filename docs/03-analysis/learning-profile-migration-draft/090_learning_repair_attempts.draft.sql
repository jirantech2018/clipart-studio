-- DRAFT — 원격 apply 금지. 필요 시 이번 단계 보류 가능.
--
-- Migration draft: 090_learning_repair_attempts
-- Feature: learning-helper (Phase 1 M2-1.8)
--
-- 목적:
--   부분 재생성 시도 기록. 문항별 최대 1회 재생성 정책 강제 + 감사 로그.
--   완료 조건이 M2-1.8 초기 스코프에 부담이면 이 파일은 M2-1.8b 로 이월.
--
-- CHECK 로 attempt=1 만 허용 (규정: 최대 1회 부분 재생성).

CREATE TABLE IF NOT EXISTS public.learning_repair_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  document_id UUID NOT NULL
    REFERENCES public.learning_documents(id) ON DELETE CASCADE,

  evaluation_id UUID NOT NULL
    REFERENCES public.learning_evaluations(id) ON DELETE CASCADE,

  failed_item_ids TEXT[] NOT NULL,

  attempt SMALLINT NOT NULL DEFAULT 1 CHECK (attempt = 1),

  failure_reasons JSONB NOT NULL DEFAULT '[]'::JSONB,

  original_items JSONB NOT NULL,
  repaired_items JSONB,

  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),

  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT learning_repair_completion_check CHECK (
    completed_at IS NULL OR completed_at >= created_at
  )
);

CREATE INDEX IF NOT EXISTS idx_learning_repair_attempts_document
  ON public.learning_repair_attempts (document_id, created_at DESC);

-- 문항별 최대 1회 강제: 같은 document + item_id 조합에서 status IN ('pending','completed')
-- 인 시도가 있으면 새 시도 불가. GIN + partial UNIQUE 는 배열이라 어려우니
-- 서비스 로직 (advisory lock) 로 dedup 하고, 여기서는 감사 로그 역할.

ALTER TABLE public.learning_repair_attempts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='learning_repair_attempts'
      AND policyname='learning_repair_attempts_select_via_document'
  ) THEN
    CREATE POLICY learning_repair_attempts_select_via_document
      ON public.learning_repair_attempts
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.learning_documents d
          WHERE d.id = learning_repair_attempts.document_id
            AND public.is_org_member(d.organization_id, (SELECT auth.uid()))
        )
      );
  END IF;
END $$;

GRANT SELECT ON public.learning_repair_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_repair_attempts TO service_role;

NOTIFY pgrst, 'reload schema';

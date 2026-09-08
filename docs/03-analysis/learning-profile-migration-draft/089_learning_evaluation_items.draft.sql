-- DRAFT — 원격 apply 금지.
--
-- Migration draft: 089_learning_evaluation_items
-- Feature: learning-helper (Phase 1 M2-1.8)
--
-- 목적:
--   문항·활동 단위 검수 결과. item_id (안정 식별자) 로 부분 재생성 대상 지정.
--
-- 사전 조건 (코드 변경):
--   LearningDocument 스키마의 모든 재생성 가능 블록에 안정적 itemId 필드 추가.
--   예: { "itemId": "q_01", "kind": "question", ... }
--   이 마이그레이션 자체는 스키마만 정의하고, itemId 부여는 orchestrator 에서.

CREATE TABLE IF NOT EXISTS public.learning_evaluation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  evaluation_id UUID NOT NULL
    REFERENCES public.learning_evaluations(id) ON DELETE CASCADE,

  item_id TEXT NOT NULL,
  item_index INTEGER NOT NULL CHECK (item_index >= 0),

  item_type TEXT NOT NULL CHECK (
    item_type IN ('question', 'activity', 'table', 'blank_space', 'reading_passage', 'other')
  ),

  criterion_key TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  reason TEXT,

  severity TEXT NOT NULL DEFAULT 'error'
    CHECK (severity IN ('warning', 'error')),

  repair_action TEXT CHECK (
    repair_action IS NULL
    OR repair_action IN ('none', 'rewrite_item', 'replace_item', 'recalculate', 'manual_review')
  ),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT learning_evaluation_item_criterion_unique
    UNIQUE (evaluation_id, item_id, criterion_key)
);

CREATE INDEX IF NOT EXISTS idx_learning_evaluation_items_failed
  ON public.learning_evaluation_items (evaluation_id, item_id)
  WHERE passed = FALSE;

ALTER TABLE public.learning_evaluation_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='learning_evaluation_items'
      AND policyname='learning_evaluation_items_select_via_evaluation'
  ) THEN
    CREATE POLICY learning_evaluation_items_select_via_evaluation
      ON public.learning_evaluation_items
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.learning_evaluations e
          JOIN public.learning_documents d ON d.id = e.document_id
          WHERE e.id = learning_evaluation_items.evaluation_id
            AND public.is_org_member(d.organization_id, (SELECT auth.uid()))
        )
      );
  END IF;
END $$;

GRANT SELECT ON public.learning_evaluation_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_evaluation_items TO service_role;

NOTIFY pgrst, 'reload schema';

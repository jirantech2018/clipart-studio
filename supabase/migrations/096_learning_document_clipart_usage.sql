-- Migration: 096_learning_document_clipart_usage
-- Feature: learning-helper (Phase 3 clipart integration)
--
-- 목적:
--   학습자료에 자동 삽입된 클립아트 사용 이력을 감사·재사용 추적용으로 기록.
--   특정 학년·과목·주제 문자열 없이 (item_id, image_id) 관계만 저장한다.
--
-- 정책:
--   - RLS: 학습자료 조회 권한과 동일 (문서 소유 조직의 활성 멤버).
--   - 이미지 삭제 시 usage 는 CASCADE.
--   - 문서 삭제 시 usage 도 CASCADE.
--   - source: 'library' (R2 라이브러리 매칭). 'generated' 는 향후 확장용.

CREATE TABLE IF NOT EXISTS public.learning_document_clipart_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  document_id UUID NOT NULL
    REFERENCES public.learning_documents(id) ON DELETE CASCADE,

  item_id TEXT NOT NULL,

  image_id UUID NOT NULL
    REFERENCES public.images(id) ON DELETE CASCADE,

  source TEXT NOT NULL DEFAULT 'library'
    CHECK (source IN ('library', 'generated')),

  hint TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT learning_document_clipart_usage_unique
    UNIQUE (document_id, item_id, image_id)
);

CREATE INDEX IF NOT EXISTS idx_learning_document_clipart_usage_doc
  ON public.learning_document_clipart_usage (document_id, item_id);

CREATE INDEX IF NOT EXISTS idx_learning_document_clipart_usage_image
  ON public.learning_document_clipart_usage (image_id);

ALTER TABLE public.learning_document_clipart_usage ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='learning_document_clipart_usage'
      AND policyname='learning_document_clipart_usage_select_via_document'
  ) THEN
    CREATE POLICY learning_document_clipart_usage_select_via_document
      ON public.learning_document_clipart_usage
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.learning_documents d
          JOIN public.organization_members om
            ON om.organization_id = d.organization_id
          WHERE d.id = learning_document_clipart_usage.document_id
            AND om.user_id = (SELECT auth.uid())
            AND om.status = 'active'
        )
      );
  END IF;
END $$;

GRANT SELECT ON public.learning_document_clipart_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_document_clipart_usage TO service_role;

NOTIFY pgrst, 'reload schema';

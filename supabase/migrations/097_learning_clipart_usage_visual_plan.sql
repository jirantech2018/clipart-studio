-- Stage 3 (VisualPlan 기반 신규 생성 흐름) 감사 컬럼 확장.
--
--   section_position: 최종 문서 내 image section 의 인덱스 (0-based).
--   visual_plan_snapshot: 이미지 생성에 사용된 VisualPlan JSON snapshot.
--   review_status: 이미지 교육 적합성 검수 결과.
--   review_reason: 검수 사유.
--
-- 기존 컬럼 (document_id, item_id, image_id, source, hint, created_at) 은 유지.
-- source 는 이번 흐름부터 항상 'generated' 로 기록 (라이브러리 선검색 제거).

ALTER TABLE public.learning_document_clipart_usage
  ADD COLUMN IF NOT EXISTS section_position INT,
  ADD COLUMN IF NOT EXISTS visual_plan_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS review_status TEXT,
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

-- source CHECK 확장: 'library' 는 legacy, 'generated' 가 신규 정책.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'learning_document_clipart_usage_source_check'
  ) THEN
    ALTER TABLE public.learning_document_clipart_usage
      DROP CONSTRAINT learning_document_clipart_usage_source_check;
  END IF;
END $$;

ALTER TABLE public.learning_document_clipart_usage
  ADD CONSTRAINT learning_document_clipart_usage_source_check
  CHECK (source IN ('generated', 'library'));

-- review_status 는 'pass' / 'retry_pass' / 'fail_used' 중 하나.
-- fail_used 는 신규 정책에서는 발생하지 않지만 감사 완결성을 위해 남긴다.
ALTER TABLE public.learning_document_clipart_usage
  ADD CONSTRAINT learning_document_clipart_usage_review_status_check
  CHECK (review_status IS NULL OR review_status IN ('pass', 'retry_pass', 'fail_used'));

-- Migration: 099_learning_ai_designed
--
-- Stage 4.4 프로덕션 통합을 위한 스키마 추가.
--
-- generation_jobs:
--   - render_mode ENUM ('standard' | 'ai_designed'), DEFAULT 'standard'
--   - ai_designed_stage TEXT NULL (진행 상태: planning/designing_pages/…)
--
-- learning_documents:
--   - render_mode ENUM ('standard' | 'ai_designed'), DEFAULT 'standard'
--   - ai_designed_metadata JSONB NULL (Stage 4.3 산출물 참조: R2 asset key, model, pipelineVersion, 검증 결과)
--
-- 기존 문서는 NULL 또는 'standard' 로 해석. rollback 시 컬럼만 DROP 하면 됨.

BEGIN;

-- render_mode 커스텀 ENUM (이미 있으면 스킵).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'learning_render_mode') THEN
    CREATE TYPE public.learning_render_mode AS ENUM ('standard', 'ai_designed');
  END IF;
END $$;

ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS render_mode public.learning_render_mode NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS ai_designed_stage TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_jobs_render_mode
  ON public.generation_jobs(kind, render_mode, status);

ALTER TABLE public.learning_documents
  ADD COLUMN IF NOT EXISTS render_mode public.learning_render_mode NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS ai_designed_metadata JSONB NULL;

COMMIT;

-- Migration: 095_learning_evaluations_run_status
-- Feature: learning-helper (V2·Plan pipeline audit)
--
-- 목적:
--   실패한 파이프라인 실행도 감사 로그에 남기도록 learning_evaluations 스키마 확장.
--   현재는 document_id NOT NULL 이라 실패 시 (learning_documents INSERT 도달 못함) 감사
--   로그가 남지 않아 원인 재현이 어렵다.
--
-- 변경:
--   1) document_id NULLABLE 로 완화 (실패 실행은 document 없이 기록)
--   2) job_id UUID NULL REFERENCES generation_jobs(id) — job 기준으로 추적
--   3) run_status TEXT — success | ai_upstream | ai_timeout | ai_parse |
--      quality_check_failed | unsupported_combination | internal_error
--   4) error_stage TEXT NULL — 실패 단계 (plan / document / review / repair / save / init)
--   5) error_code TEXT NULL — 내부 오류 코드
--   6) error_message TEXT NULL — 짧은 실패 요약 (500자 이내). 상세는 result JSONB.
--
-- 안전:
--   - 순수 ADD COLUMN + NOT NULL 완화. 기존 rows 는 run_status='success' 로 백필.
--   - CHECK constraint 로 조합 검증 (성공 시 document_id 필수, 실패 시 job_id 필수).
--   - 애플리케이션 코드는 이 마이그레이션 apply 후에도 기존처럼 삽입 가능.

BEGIN;

-- 1) document_id NULLABLE
ALTER TABLE public.learning_evaluations
  ALTER COLUMN document_id DROP NOT NULL;

-- 2) 신규 컬럼
ALTER TABLE public.learning_evaluations
  ADD COLUMN IF NOT EXISTS job_id UUID
    REFERENCES public.generation_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS run_status TEXT NOT NULL DEFAULT 'success'
    CHECK (run_status IN (
      'success',
      'ai_upstream',
      'ai_timeout',
      'ai_parse',
      'quality_check_failed',
      'unsupported_combination',
      'internal_error'
    )),
  ADD COLUMN IF NOT EXISTS error_stage TEXT
    CHECK (
      error_stage IS NULL
      OR error_stage IN ('init', 'context', 'plan', 'document', 'review', 'repair', 'save')
    ),
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT
    CHECK (error_message IS NULL OR char_length(error_message) <= 1000);

-- 3) 조합 검증
ALTER TABLE public.learning_evaluations
  DROP CONSTRAINT IF EXISTS learning_evaluations_success_or_failure_ck;
ALTER TABLE public.learning_evaluations
  ADD CONSTRAINT learning_evaluations_success_or_failure_ck CHECK (
    (run_status = 'success' AND document_id IS NOT NULL)
    OR (run_status <> 'success' AND job_id IS NOT NULL)
  );

-- 4) 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_learning_evaluations_job
  ON public.learning_evaluations (job_id, created_at DESC)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learning_evaluations_run_status
  ON public.learning_evaluations (run_status, created_at DESC);

COMMIT;

NOTIFY pgrst, 'reload schema';

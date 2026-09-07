-- Migration: 082_generation_jobs_kind
-- Feature: learning-helper (Phase 1 M1)
-- Plan Ref: docs/01-plan/features/learning-helper.plan.md v0.4 §M1
--
-- 사전 조건:
--   052_generation_jobs_package 에서 이미 job_kind_enum('single','package') 을
--   만들었다. 여기서는 그 enum 에 'learning_doc' 값만 추가 하고, learning
--   document 를 결과로 연결할 FK 컬럼을 추가한다.
--
-- 정책 (사용자 지시):
--   - image-gen handler 코드는 이동하지 않고 dispatcher 만 신규. 회귀 방지.
--   - kind='learning_doc' job 은 기존 필수 컬럼(prompt/batch_size) 에 placeholder
--     값 사용 → CHECK BETWEEN 1 AND 50 만족.
--       prompt = "{학년}학년 {과목} · {자료유형} · {주제}"
--       batch_size = 1
--   - active-job unique index 는 kind 별로 분리해 이미지 job 진행 중에도 학습
--     자료 job 을 시작할 수 있게 한다.

-- 1) enum 확장. IF NOT EXISTS 는 Postgres 12+.
ALTER TYPE public.job_kind_enum ADD VALUE IF NOT EXISTS 'learning_doc';

-- 2) 결과 FK 컬럼. 081 에서 learning_documents 생성됨.
ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS learning_document_id UUID
    REFERENCES public.learning_documents(id) ON DELETE SET NULL;

-- 3) active-job unique index 를 kind 별로 분리.
--    기존 idx_jobs_active_per_user 는 image job (kind='single' 또는 'package')
--    만 대상으로 유지하고, learning_doc 은 별도 index 신설.
DROP INDEX IF EXISTS public.idx_jobs_active_per_user;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_per_user_image
  ON public.generation_jobs(user_id)
  WHERE status IN ('queued', 'running') AND kind IN ('single', 'package');

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_per_user_learning
  ON public.generation_jobs(user_id)
  WHERE status IN ('queued', 'running') AND kind = 'learning_doc';

-- 4) 조회 편의를 위한 인덱스.
CREATE INDEX IF NOT EXISTS idx_generation_jobs_kind_status
  ON public.generation_jobs(kind, status);

NOTIFY pgrst, 'reload schema';

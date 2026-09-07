-- Migration: 083_generation_jobs_learning_doc_wiring
-- Feature: learning-helper (Phase 1 M1)
-- Depends on: 082_generation_jobs_kind_enum_add
-- Plan Ref: docs/01-plan/features/learning-helper.plan.md v0.4 §M1
--
-- 사전 조건:
--   082 가 별도 트랜잭션으로 이미 커밋되어 'learning_doc' enum 값을 사용할 수 있어야 함.
--
-- 이 파일이 담당하는 작업:
--   1) learning_documents FK 컬럼 추가
--   2) kind 별 active-job unique index 신설 (image / learning 각각)
--   3) 두 신규 인덱스 생성 성공을 확인한 뒤 기존 인덱스 제거
--   4) 조회 편의 인덱스 (kind + status)
--
-- 인덱스 교체 순서 (사용자 지시, 제약 공백 방지):
--   step 1) CREATE UNIQUE INDEX idx_jobs_active_per_user_image     ← 기존 인덱스와 공존
--   step 2) CREATE UNIQUE INDEX idx_jobs_active_per_user_learning  ← 완전 새 조건
--   step 3) DROP INDEX idx_jobs_active_per_user                    ← 두 신규 인덱스 성공 후 제거
--
-- 왜 이 순서가 안전한가:
--   기존 인덱스 조건: WHERE status IN ('queued','running')  — kind 무관하게 user_id UNIQUE
--   신규 image 조건:  WHERE status IN ('queued','running') AND kind IN ('single','package')
--   기존과 신규 image 는 "이미지 job (kind='single' or 'package') 이 실행 중일 때 같은 사용자
--   두 번째 이미지 job 을 막는다" 는 실제 제약이 정확히 동치. 두 인덱스가 동시에 존재하는 동안
--   기존 데이터는 두 제약을 모두 이미 만족하므로 CREATE 는 실패하지 않는다.
--   신규 learning 조건은 kind='learning_doc' 만 대상 → 기존 데이터에 learning_doc row 가 없으니
--   즉시 성공. 마지막에 기존 인덱스를 drop 해도 제약이 완전히 사라지는 순간이 없다.
--
-- 재실행 안전성:
--   모든 CREATE 는 IF NOT EXISTS, DROP 은 IF EXISTS. 부분 성공 후 재실행 안전.

-- 1) FK 컬럼
ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS learning_document_id UUID
    REFERENCES public.learning_documents(id) ON DELETE SET NULL;

-- 2) 신규 이미지용 인덱스 (기존 인덱스와 공존한 채로 CREATE — 제약 강화)
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_per_user_image
  ON public.generation_jobs(user_id)
  WHERE status IN ('queued', 'running') AND kind IN ('single', 'package');

-- 3) 신규 학습자료용 인덱스 (기존 조건과 겹치지 않는 완전 새 slot)
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_per_user_learning
  ON public.generation_jobs(user_id)
  WHERE status IN ('queued', 'running') AND kind = 'learning_doc';

-- 4) 두 신규 인덱스가 실제로 만들어졌는지 방어적 확인. 없으면 예외로 롤백.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_jobs_active_per_user_image'
  ) THEN
    RAISE EXCEPTION '신규 인덱스 idx_jobs_active_per_user_image 생성 실패 — 기존 인덱스 drop 을 진행하지 않습니다';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_jobs_active_per_user_learning'
  ) THEN
    RAISE EXCEPTION '신규 인덱스 idx_jobs_active_per_user_learning 생성 실패 — 기존 인덱스 drop 을 진행하지 않습니다';
  END IF;
END $$;

-- 5) 두 신규 인덱스 확인 성공 → 기존 인덱스 제거
DROP INDEX IF EXISTS public.idx_jobs_active_per_user;

-- 6) 조회 편의 인덱스
CREATE INDEX IF NOT EXISTS idx_generation_jobs_kind_status
  ON public.generation_jobs(kind, status);

NOTIFY pgrst, 'reload schema';

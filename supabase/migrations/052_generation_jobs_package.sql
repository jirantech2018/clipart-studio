-- Migration: 052_generation_jobs_package
--
-- Package generation mode 도입 — 하나의 job 아래 여러 category × 여러 slot 을
-- 갖는 "테마별(목적별) 패키지" 실행.
--
-- 방향:
--   generation_jobs 는 그대로 유지하고 kind + package_plan (snapshot) 만
--   추가한다. Slot 은 별도 테이블 (053) 로 분리해 원자적 claim + 개별 상태
--   추적을 지원한다. 새 package_jobs 테이블을 만들지 않음으로써:
--     - 활성 Job 1개 제약 (idx_jobs_active_per_user) 그대로 유지
--     - 크레딧 예약 · 취소 · SSE · v2 conversation store SSE hook · images.batch_id
--       관계 모두 그대로 재사용
--
-- batch_size CHECK 는 기존 `BETWEEN 1 AND 50` 을 그대로 유지 (Phase 2 상한).
-- Package 도 이 범위 안이어야 하며, 서버는 크레딧 예약 직전 다시 검증한다.

CREATE TYPE job_kind_enum AS ENUM ('single', 'package');

ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS kind job_kind_enum NOT NULL DEFAULT 'single';

ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS package_plan JSONB;

-- package_plan 은 kind='package' 일 때만 채워지는 원본 snapshot.
-- shape 는 앱 레이어(zod)에서 강제하고, DB 는 최소 형식만 방어.
ALTER TABLE public.generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_package_plan_shape;

ALTER TABLE public.generation_jobs
  ADD CONSTRAINT generation_jobs_package_plan_shape
  CHECK (
    package_plan IS NULL
    OR jsonb_typeof(package_plan) = 'object'
  );

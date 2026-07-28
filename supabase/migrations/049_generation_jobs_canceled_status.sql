-- Migration: 049_generation_jobs_canceled_status
--
-- 사용자 취소 기능(POST /api/jobs/[id]/cancel) 도입.
-- job_status_enum 에 'canceled' 값을 추가한다.
--
-- ALTER TYPE ADD VALUE 는 PostgreSQL 12+ 에서 트랜잭션 내 실행이 허용되지만
-- 같은 트랜잭션에서 그 값을 즉시 사용하는 것은 여전히 제한된다. 이 파일은
-- 새 값을 이 파일 내부에서 즉시 참조하지 않으므로 안전.
--
-- unique 인덱스 idx_jobs_active_per_user 는 status IN ('queued','running') 로
-- 이미 걸려 있어, canceled 는 active 로 취급되지 않는다 (다시 새 배치 시작 가능).

ALTER TYPE job_status_enum ADD VALUE IF NOT EXISTS 'canceled';

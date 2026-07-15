-- Migration: 027_batch_size_range
-- generation_jobs.batch_size 의 CHECK 를 "5의 배수 (5..30)" 에서 "1..50 범위" 로 완화.
-- 프론트/서버가 새로 허용하는 1장/2장/자유입력 배치가 DB constraint 에 걸려
-- INSERT 실패 (Job 생성 실패 500) 나던 문제를 해결한다.

-- 014 에서 만든 CHECK 는 자동 이름 (generation_jobs_batch_size_check) 을 갖지만,
-- 환경에 따라 다를 수 있으므로 동적으로 찾아서 제거한다.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.generation_jobs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%batch_size%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.generation_jobs DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.generation_jobs
  ADD CONSTRAINT generation_jobs_batch_size_range
  CHECK (batch_size BETWEEN 1 AND 50);

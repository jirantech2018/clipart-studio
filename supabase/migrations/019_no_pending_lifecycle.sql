-- Migration: 019_no_pending_lifecycle
-- Policy change: generated images are permanent library assets on creation.
-- Consequences:
--   1. Any existing 'pending' rows are promoted to 'saved' (no data loss).
--   2. pending_expires_at is cleared.
--   3. The hourly pg_cron job from 017 is unscheduled and its function dropped.
--   4. status enum still contains 'pending' and 'discarded' for historical rows,
--      but new inserts will always use 'saved'. Enum unchanged to avoid ALTER TYPE
--      downtime; if pruning is desired later, do it in a dedicated migration.

-- 1 + 2. Backfill any leftover pending images
UPDATE public.images
   SET status = 'saved',
       pending_expires_at = NULL
 WHERE status = 'pending';

-- 3. Unschedule the hourly cleanup job (safe if already gone)
DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  SELECT jobid INTO v_job_id
    FROM cron.job
   WHERE jobname = 'cleanup-pending-images-hourly';

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.cleanup_pending_images();

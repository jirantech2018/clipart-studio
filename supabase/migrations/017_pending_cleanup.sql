-- Migration: 017_pending_cleanup
-- Design Ref: §9 Behavior Rule 2 (24h auto-delete of pending images)
-- Plan SC: FR-19, R7 (R2 storage cost control)
--
-- Uses pg_cron (available on Supabase). Runs every hour.
-- Note: If pg_cron is not enabled on the project, enable it via
-- Supabase Dashboard → Database → Extensions → pg_cron before running this.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION cleanup_pending_images()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM images
   WHERE status = 'pending'
     AND pending_expires_at IS NOT NULL
     AND pending_expires_at <= NOW();

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION cleanup_pending_images() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_pending_images() TO service_role;

-- Schedule: every hour at :00
SELECT cron.schedule(
  'cleanup-pending-images-hourly',
  '0 * * * *',
  $$SELECT cleanup_pending_images();$$
);

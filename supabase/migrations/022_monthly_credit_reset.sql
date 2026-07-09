-- Migration: 022_monthly_credit_reset
-- Design Ref: §9 Behavior Rule (월 30 크레딧 지급) + Plan SC FR-12
-- Semantics: when a user's credits_reset_at is due, add 30 credits and roll the
-- reset date forward by 1 month. Additive (not overwriting) so unused credits
-- carry over — this matches the "만들면 계정의 자산이 됩니다" ethos.
--
-- 001_profiles.handle_new_user seeds credits_reset_at = NOW() + INTERVAL '1 month'
-- so each user has their own anniversary. The cron job runs daily; users past
-- their anniversary get topped up on the next tick.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION monthly_credit_reset()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  WITH bumped AS (
    UPDATE profiles
       SET credits          = credits + 30,
           credits_reset_at = credits_reset_at + INTERVAL '1 month'
     WHERE credits_reset_at IS NOT NULL
       AND credits_reset_at <= NOW()
     RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM bumped;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION monthly_credit_reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION monthly_credit_reset() TO service_role;

-- Schedule: 매일 KST 03:00 (UTC 18:00)
SELECT cron.schedule(
  'monthly-credit-reset-daily',
  '0 18 * * *',
  $$SELECT monthly_credit_reset();$$
);

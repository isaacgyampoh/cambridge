-- ============================================================================
-- 0003 — SMS DELIVERY QUEUE
--
-- Run AFTER 0002_lead_assignment.sql. Additive: adds columns to the existing
-- sms_logs table and creates one index. No data is removed.
--
-- sms_logs was a write-only record of what had been attempted: recipient,
-- message, status, provider response. It could not answer the questions that
-- matter operationally — what was this message FOR, how many times have we
-- tried, when should we try again, and has this exact message already been
-- sent? Those four gaps are why a transient provider failure became a
-- permanently lost message that nobody could see.
-- ============================================================================

BEGIN;

-- What the message was for, and which record it belongs to.
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS kind          TEXT;
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS entity_id     UUID;

-- Delivery bookkeeping.
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS attempts      INT NOT NULL DEFAULT 0;
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS max_attempts  INT NOT NULL DEFAULT 4;
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS last_error    TEXT;
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ;

-- The idempotency key. A unique index is what actually prevents a duplicate:
-- a prior SELECT cannot, because two webhook deliveries can both read "not
-- sent" before either writes.
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS dedupe_key    TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_logs_dedupe
  ON sms_logs(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- The queue scan: rows still worth another attempt.
CREATE INDEX IF NOT EXISTS idx_sms_logs_retry
  ON sms_logs(next_retry_at)
  WHERE status IN ('queued', 'retrying');

CREATE INDEX IF NOT EXISTS idx_sms_logs_status  ON sms_logs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_logs_entity  ON sms_logs(entity_id);

-- Rows written before this migration have no status vocabulary in common with
-- the queue; leave their history intact but take them out of the retry scan.
UPDATE sms_logs SET next_retry_at = NULL
 WHERE next_retry_at IS NULL AND status NOT IN ('queued', 'retrying');

/*
 * Claim a batch of due messages for one worker.
 *
 * SKIP LOCKED is the important part: two cron invocations overlapping — which
 * happens whenever a run takes longer than its interval — take disjoint sets
 * of rows instead of both sending the same message.
 */
CREATE OR REPLACE FUNCTION claim_due_sms(p_limit INT DEFAULT 25)
RETURNS SETOF sms_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE sms_logs
     SET status = 'sending', attempts = attempts + 1
   WHERE id IN (
     SELECT id FROM sms_logs
      WHERE status IN ('queued', 'retrying')
        AND attempts < max_attempts
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION claim_due_sms(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_due_sms(INT) TO service_role;

COMMIT;

-- ============================================================================
-- OPERATIONAL QUERIES
--
--   Messages that have given up entirely:
--     SELECT kind, recipient, last_error, attempts, created_at
--       FROM sms_logs WHERE status = 'failed' ORDER BY created_at DESC;
--
--   Currently stuck in the queue:
--     SELECT kind, COUNT(*) FROM sms_logs
--      WHERE status IN ('queued','retrying') GROUP BY kind;
-- ============================================================================

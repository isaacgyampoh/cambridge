-- ============================================================================
-- 0012 — KEEP THE PROVIDER'S OWN MESSAGE REFERENCE
--
-- Run AFTER 0011. Additive: one column and one index. Nothing removed.
--
-- WHY
--
-- An administrator needs to be able to answer "why didn't this member of staff
-- receive their SMS?" from the system. Everything needed for that was already
-- recorded except the one field Arkesel itself indexes by: their message id.
--
-- Without it, a support conversation is "a text to 0201234567 some time on
-- Tuesday" rather than a reference. It is also the only evidence that can
-- later settle whether a request that timed out on our side was in fact
-- delivered — the case where a naive retry sends the same message twice.
--
-- The response body was already stored in provider_response, but as opaque
-- JSON that cannot be indexed or searched. This lifts the id out of it.
-- ============================================================================

BEGIN;

ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

-- Looked up when a delivery report arrives, or when someone is chasing one
-- message. Partial, because only sent messages ever have one.
CREATE INDEX IF NOT EXISTS idx_sms_logs_provider_msg
  ON sms_logs(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Backfill from what was already captured.
--
-- The shape is not a guess: all 438 delivered messages in this database carry
-- it at data[0].id, alongside the recipient Arkesel echoed back. The other
-- spellings are kept because the extractor accepts them too, and a response
-- shape that changes under us should land in the column rather than nowhere.
--
--   {"data":[{"id":"01770509-...","recipient":"233266381203"}],
--    "status":"success","sms_balance":0,"main_balance":591.127}
UPDATE sms_logs
   SET provider_message_id = COALESCE(
         provider_response->'data'->0->>'id',
         provider_response->'data'->>'id',
         provider_response->'data'->0->>'message_id',
         provider_response->>'message_id',
         provider_response->>'messageId',
         provider_response->>'id'
       )
 WHERE provider_message_id IS NULL
   AND provider_response IS NOT NULL
   AND jsonb_typeof(provider_response) = 'object';

/*
 * Rows stranded mid-attempt.
 *
 * claim_due_sms flips a row to 'sending' as it claims it, which is what stops
 * a second worker taking the same message. But nothing moves it back: if the
 * function is killed between the claim and the update — the exact way the lead
 * import used to die — the row sits in 'sending' forever. 'sending' is not in
 * the reclaim predicate, so it is never retried and never appears in the
 * failed list either. It is simply lost, silently, which is the failure mode
 * this whole queue exists to remove.
 *
 * The claim now takes a LEASE: it stamps next_retry_at fifteen minutes ahead
 * as it flips the row to 'sending'. A worker that finishes overwrites that
 * stamp with the real outcome — NULL on success, the true backoff on failure.
 * A worker that dies leaves the lease to expire, and the row becomes
 * claimable again.
 *
 * The lease has to be a fresh stamp rather than the row's age: a message
 * queued two hours ago and claimed one second ago is not abandoned, and
 * anything keyed on created_at would hand it straight to a second worker —
 * manufacturing the duplicate this function exists to prevent. Fifteen
 * minutes is well beyond the fifteen-second transport timeout and the
 * platform's own execution ceiling, so a request still genuinely in flight
 * cannot be taken twice.
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
     SET status        = 'sending',
         attempts      = attempts + 1,
         next_retry_at = NOW() + INTERVAL '15 minutes'   -- the lease
   WHERE id IN (
     SELECT id FROM sms_logs
      WHERE attempts < max_attempts
        AND (
          -- Due for its next attempt.
          (status IN ('queued', 'retrying')
           AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
          OR
          -- Claimed by a worker that did not survive its attempt.
          (status = 'sending'
           AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
        )
      ORDER BY created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION claim_due_sms(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_due_sms(INT) TO service_role;

-- Rows already stranded in 'sending' before this migration have no lease and
-- would never be reclaimed. Give them one that has already expired, so the
-- next worker picks them up.
UPDATE sms_logs
   SET next_retry_at = NOW() - INTERVAL '1 minute'
 WHERE status = 'sending' AND next_retry_at IS NULL;

COMMIT;

-- ============================================================================
-- ANSWERING "WHY DIDN'T THEY GET IT?"
--
--   Everything known about messages to one number, most recent first:
--
--     SELECT kind, status, attempts, provider_message_id,
--            created_at, sent_at, next_retry_at, last_error
--       FROM sms_logs
--      WHERE recipient = '233201234567'
--      ORDER BY created_at DESC;
--
--   Messages that gave up entirely, grouped by why:
--
--     SELECT last_error, count(*) FROM sms_logs
--      WHERE status = 'failed' GROUP BY 1 ORDER BY 2 DESC;
-- ============================================================================

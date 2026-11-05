-- ============================================================================
-- ONE CLICK, THE WHOLE CAMPAIGN.
--
--   Tables created     info_session_recipients
--   Functions created  claim_info_session_batch, info_session_progress
--   Indexes created    3
--   Destructive        NO. Creates and adds only. No DROP, no DELETE.
--   Idempotent         YES. Safe to run more than once.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- Sending an info session messaged leads in a loop inside the request that
-- pressed Send. A serverless invocation does not live long enough for a few
-- hundred of them, so the run stopped at a time budget and told the operator
-- to press Send again — five or six times for a list of eight hundred. That
-- is not sending; it is asking a person to be the scheduler.
--
-- A campaign needs somewhere durable to keep WHO IS LEFT, so that any
-- invocation can pick it up, two of them cannot take the same person, and a
-- run that dies mid-way is continued rather than restarted.
--
-- ── WHY A TABLE AND NOT sms_logs ────────────────────────────────────────────
--
-- sms_logs already records one row per text with a dedupe key, which is a
-- fine ledger for SMS and no ledger at all for the other two channels. A lead
-- reached on WhatsApp leaves no row there, so the next batch would find them
-- "unsent" and text them as well — the same person messaged twice, through
-- the door the dedupe key does not cover.
--
-- This table is per RECIPIENT, not per message: one row per campaign per
-- lead, whichever channel ends up carrying it.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS info_session_recipients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES info_sessions(id) ON DELETE CASCADE,
  lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  /*
   * Copied from the lead when the campaign is enrolled, so the audience is
   * fixed at the moment of sending. A lead edited mid-campaign does not
   * change who was in it, and a lead deleted does not strand a row.
   */
  phone       TEXT,
  email       TEXT,

  -- pending → claimed → sent | failed | unreachable
  status      TEXT NOT NULL DEFAULT 'pending',
  /** Which channel actually carried it. NULL until one did. */
  channel     TEXT,
  attempts    INT  NOT NULL DEFAULT 0,
  last_error  TEXT,
  claimed_at  TIMESTAMPTZ,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  /*
   * The idempotency identity the whole design rests on. One row per campaign
   * per lead, so enrolling twice is a no-op and nobody can be enrolled twice.
   */
  UNIQUE (session_id, lead_id)
);

-- The question every batch asks: what is left of this campaign?
CREATE INDEX IF NOT EXISTS idx_isr_session_status
  ON info_session_recipients (session_id, status);

-- The recovery sweep: are there campaigns with work outstanding anywhere?
CREATE INDEX IF NOT EXISTS idx_isr_pending
  ON info_session_recipients (status, claimed_at)
  WHERE status IN ('pending', 'claimed');

CREATE INDEX IF NOT EXISTS idx_isr_lead
  ON info_session_recipients (lead_id);

ALTER TABLE info_session_recipients ENABLE ROW LEVEL SECURITY;

/*
 * No policy, deliberately. Everything that touches this table goes through
 * the service role in a guarded route; with RLS on and no policy, the anon
 * and authenticated keys can read nothing, which is the intent.
 */

-- ---------------------------------------------------------------------------
-- CLAIMING A BATCH
--
-- FOR UPDATE SKIP LOCKED is the whole point: two workers running at once take
-- different rows instead of racing for the same ones, and neither waits. A
-- row claimed by a worker that then died is reclaimed after five minutes, so
-- a timeout costs a delay and never a lost recipient.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_info_session_batch(
  p_session UUID,
  p_limit   INT DEFAULT 50,
  p_stale   INTERVAL DEFAULT '5 minutes'
)
RETURNS SETOF info_session_recipients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE info_session_recipients r
     SET status = 'claimed',
         claimed_at = NOW(),
         attempts = r.attempts + 1
   WHERE r.id IN (
     SELECT c.id
       FROM info_session_recipients c
      WHERE c.session_id = p_session
        AND (
          c.status = 'pending'
          -- Abandoned by a worker that never came back.
          OR (c.status = 'claimed' AND c.claimed_at < NOW() - p_stale)
        )
        -- Four attempts is enough to tell a blip from a dead number.
        AND c.attempts < 4
      ORDER BY c.created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING r.*;
END;
$$;

-- ---------------------------------------------------------------------------
-- WHERE A CAMPAIGN HAS GOT TO
--
-- One row of counts, for the progress the Information section shows while it
-- runs. Counted in the database rather than by pulling every recipient into
-- the application to count them there.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION info_session_progress(p_session UUID)
RETURNS TABLE (
  total       BIGINT,
  pending     BIGINT,
  processing  BIGINT,
  sent        BIGINT,
  failed      BIGINT,
  unreachable BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COUNT(*)                                              AS total,
    COUNT(*) FILTER (WHERE status = 'pending')            AS pending,
    COUNT(*) FILTER (WHERE status = 'claimed')            AS processing,
    COUNT(*) FILTER (WHERE status = 'sent')               AS sent,
    COUNT(*) FILTER (WHERE status = 'failed')             AS failed,
    COUNT(*) FILTER (WHERE status = 'unreachable')        AS unreachable
  FROM info_session_recipients
  WHERE session_id = p_session;
$$;

COMMIT;

-- After running, this should return the three objects:
--
--   SELECT 'table' k, count(*) FROM information_schema.tables
--    WHERE table_name = 'info_session_recipients'
--   UNION ALL
--   SELECT 'functions', count(*) FROM pg_proc
--    WHERE proname IN ('claim_info_session_batch', 'info_session_progress');

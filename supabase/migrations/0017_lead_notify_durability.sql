-- ─────────────────────────────────────────────────────────────────────────────
-- Lead-assignment notifications survive a failed send
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
--
-- /api/leads/notify-pending finished each marketer with:
--
--     await sb.from('lead_assign_pending')
--       .update({ pending: 0, last_sms_at: new Date().toISOString() })
--       .eq('marketer_id', p.marketer_id)
--
-- lead_assign_pending has three columns — marketer_id, pending, last_lead_at.
-- There is no last_sms_at and there never was. PostgREST rejects the whole
-- statement, so `pending` was not cleared either; and the result was not
-- read, so nothing said so.
--
-- The consequences pull in opposite directions, which is why this was hard to
-- see from the outside:
--
--   * A marketer WITH a phone kept a standing pending count and was texted
--     again on every run of the cron, indefinitely.
--   * A marketer with NO phone took the other branch — an update with no
--     last_sms_at, which succeeds — and was silently cleared, so the leads
--     they had been given were never announced at all.
--
-- Neither the failed update nor a failed send was checked. Both are now.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--
-- last_sms_at  the column the code has been trying to write since the
--              endpoint was written
-- attempts     runs that failed to queue this batch, so a transient provider
--              outage is retried rather than discarded, and a permanently
--              broken row is given up on rather than retried forever
-- last_error   why the last attempt failed, so an administrator can see that
--              somebody is receiving leads nobody can text them about
--
-- IF NOT EXISTS throughout: this migration is safe to run more than once, and
-- safe on an instance where someone has already added a column by hand.

ALTER TABLE lead_assign_pending ADD COLUMN IF NOT EXISTS last_sms_at TIMESTAMPTZ;
ALTER TABLE lead_assign_pending ADD COLUMN IF NOT EXISTS attempts    INT NOT NULL DEFAULT 0;
ALTER TABLE lead_assign_pending ADD COLUMN IF NOT EXISTS last_error  TEXT;

-- The endpoint reads rows with pending > 0 that have settled, ordered by
-- nothing in particular. This is the index for that predicate.
CREATE INDEX IF NOT EXISTS lead_assign_pending_due_idx
  ON lead_assign_pending (last_lead_at)
  WHERE pending > 0;

COMMENT ON COLUMN lead_assign_pending.attempts IS
  'Cron runs that failed to queue this batch. Cleared once queued; the batch is abandoned and logged after 6.';
COMMENT ON COLUMN lead_assign_pending.last_error IS
  'Why the last notification attempt failed. Non-null here means someone is receiving leads they are not being told about.';

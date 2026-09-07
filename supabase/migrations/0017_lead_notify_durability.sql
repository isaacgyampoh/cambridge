-- ─────────────────────────────────────────────────────────────────────────────
-- An index for the lead-notification sweep
-- ─────────────────────────────────────────────────────────────────────────────
--
-- OPTIONAL. Nothing waits on this migration: /api/leads/notify-pending is
-- correct on the schema as it stands, and applying this only makes its query
-- cheaper. It is recorded here so the fix below is written down somewhere
-- other than a commit message.
--
-- ── THE BUG THIS FOLLOWS ────────────────────────────────────────────────────
--
-- The endpoint used to finish each marketer with
--
--     .update({ pending: 0, last_sms_at: now() })
--
-- and lead_assign_pending has three columns: marketer_id, pending,
-- last_lead_at. There is no last_sms_at and there never was — migration 0002
-- created this table and nothing has altered it since. PostgREST rejects the
-- whole statement, so `pending` was not cleared either; the result was never
-- read, so nothing said so; and the send itself was inside a bare catch {}.
--
-- The two branches failed in opposite directions, which is why it was hard to
-- see from outside:
--
--   * a marketer WITH a phone kept a standing count and was re-texted on
--     every run of the cron, indefinitely;
--   * a marketer with NO phone took the other branch — an update with no
--     last_sms_at, which succeeds — and was cleared silently, so the leads
--     they had been given were never announced at all.
--
-- ── WHY NO COLUMNS ARE ADDED ────────────────────────────────────────────────
--
-- The obvious repair is last_sms_at plus a retry counter. It is also the
-- wrong one: it would make the endpoint correct only AFTER someone applied a
-- migration by hand, and until then exactly as broken as before — on the
-- workflow that is failing right now.
--
-- Everything needed was already present. Retries and backoff belong to
-- sms_logs, which the SMS queue maintains; a counter here would be a second,
-- worse copy of it. Deduplication belongs to the queue's unique dedupe_key,
-- which is what makes it safe to leave a count standing after a failure. And
-- the one failure that would otherwise retry for ever — a phone number that
-- can never be delivered to — is decided in the endpoint before queueing,
-- with the same normaliseRecipient the sender uses.
--
-- So the endpoint reads and writes only marketer_id and pending, and this
-- migration adds no columns.

-- The sweep reads rows with a positive count whose last lead has settled.
-- Partial, because rows with nothing pending are the overwhelming majority
-- and are never selected.
CREATE INDEX IF NOT EXISTS lead_assign_pending_due_idx
  ON lead_assign_pending (last_lead_at)
  WHERE pending > 0;

COMMENT ON TABLE lead_assign_pending IS
  'Per-marketer count of leads assigned but not yet announced by SMS. Cleared by /api/leads/notify-pending only once the message is queued — never before, which is the bug this replaced.';

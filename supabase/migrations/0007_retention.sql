-- ============================================================================
-- 0007 — RETENTION FOR HIGH-VOLUME LOG TABLES
--
-- Run AFTER 0006. Additive: creates one function and three indexes.
--
-- Idempotent: safe to re-run. NOT destructive in itself — it creates the
-- pruning function but does not call it. The first call, from the cron runner,
-- IS destructive by design: it deletes rows older than the retention window.
-- Read the windows below and change them before applying if they do not suit.
--
-- WHY
--
-- An audit of the live database found webhook_inbox holding 10,653 rows in
-- 9.4 MB — a third of the entire 29 MB database — accumulated over 23 days,
-- roughly 460 rows a day, with nothing ever removing them. It is raw inbound
-- webhook payloads kept for debugging. Useful for a week; dead weight after a
-- month; the largest table in the database within a quarter.
--
-- The message logs grow for the same reason. They matter more, because they
-- are also the tables that leaked personal data before RLS was enabled, so
-- keeping less of them for less time is a privacy improvement as well as a
-- storage one.
-- ============================================================================

BEGIN;

/*
 * Retention windows, in days. Chosen so that:
 *   - debugging payloads outlive any realistic investigation (30 days)
 *   - message logs outlive a term's worth of "did the student get the text?"
 *     questions (180 days), then stop holding phone numbers and message
 *     bodies indefinitely
 *   - login events keep a useful security trail (365 days)
 *
 * audit_logs is deliberately ABSENT. An audit trail that prunes itself is not
 * an audit trail.
 */
CREATE OR REPLACE FUNCTION prune_old_logs()
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted BIGINT;
BEGIN
  -- Raw webhook payloads: 30 days.
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='webhook_inbox') THEN
    DELETE FROM webhook_inbox WHERE created_at < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'webhook_inbox'; rows_deleted := v_deleted; RETURN NEXT;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='webhook_debug') THEN
    DELETE FROM webhook_debug WHERE created_at < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'webhook_debug'; rows_deleted := v_deleted; RETURN NEXT;
  END IF;

  -- Message logs: 180 days. These carry phone numbers, email addresses and
  -- message bodies, so the window is a privacy decision as much as a storage
  -- one. Anything still queued or retrying is kept regardless of age.
  DELETE FROM sms_logs
   WHERE sent_at < NOW() - INTERVAL '180 days'
     AND (status IS NULL OR status NOT IN ('queued', 'retrying', 'sending'));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  table_name := 'sms_logs'; rows_deleted := v_deleted; RETURN NEXT;

  DELETE FROM whatsapp_logs WHERE sent_at < NOW() - INTERVAL '180 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  table_name := 'whatsapp_logs'; rows_deleted := v_deleted; RETURN NEXT;

  DELETE FROM email_logs WHERE sent_at < NOW() - INTERVAL '180 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  table_name := 'email_logs'; rows_deleted := v_deleted; RETURN NEXT;

  -- Security trail: a full year.
  DELETE FROM login_events WHERE created_at < NOW() - INTERVAL '365 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  table_name := 'login_events'; rows_deleted := v_deleted; RETURN NEXT;

  -- Deduplication bookkeeping: once a provider will no longer retry an event,
  -- remembering it serves no purpose. 30 days is far beyond any retry window.
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='processed_events') THEN
    DELETE FROM processed_events WHERE processed_at < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'processed_events'; rows_deleted := v_deleted; RETURN NEXT;
  END IF;

  -- Rate-limit counters expire logically; this just keeps the table small.
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='auth_throttle') THEN
    DELETE FROM auth_throttle
     WHERE window_start < NOW() - INTERVAL '1 day'
       AND (blocked_until IS NULL OR blocked_until < NOW());
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'auth_throttle'; rows_deleted := v_deleted; RETURN NEXT;
  END IF;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION prune_old_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION prune_old_logs() TO service_role;

-- The pruning scans are all "older than X", so each needs its date column
-- indexed or the delete itself becomes a sequential scan.
CREATE INDEX IF NOT EXISTS idx_webhook_inbox_created  ON webhook_inbox(created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_sent     ON whatsapp_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent        ON email_logs(sent_at);

COMMIT;

-- ============================================================================
-- FIRST RUN
--
--   Check what WOULD be removed before removing it:
--     SELECT count(*) FROM webhook_inbox WHERE created_at < NOW() - INTERVAL '30 days';
--
--   Then prune:
--     SELECT * FROM prune_old_logs();
--
--   After that the cron runner calls it nightly via /api/cron/run.
-- ============================================================================

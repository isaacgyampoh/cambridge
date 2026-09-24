-- ============================================================================
-- URGENT: NINE TABLES ARE READABLE BY ANYONE WITH THE PUBLIC ANON KEY
--
-- Verified against production on 24 Sep 2026 with the anon key alone — the key
-- that is compiled into the browser bundle and that anybody who opens the
-- portal already has. The repository is public, so it is trivially findable.
--
--   webhook_inbox         3,020 rows — and the raw bodies of events written
--                         before 22 Sep carry `sessionId`, which IS the
--                         WasenderAPI session API key. 15 of 20 sampled.
--   notifications           261 rows
--   ai_conversations         17 rows — customer conversations
--   student_fees              7 rows — money owed, per student
--   lead_comments                    — staff notes on named people
--   marketer_enrollments             — who earned what
--   message_jobs                     — queued outbound messages
--   settings                         — application configuration
--   processed_events                 — payment idempotency records
--
-- leads and profiles are NOT affected: they were covered by 0001 and return
-- nothing to the anon key.
--
-- ── HOW THIS HAPPENED ──────────────────────────────────────────────────────
--
-- 0001_security_hardening enabled RLS on the tables that existed then. Every
-- one of these nine was created afterwards — by a later migration or directly
-- — and no migration ever enabled RLS on them. Nothing failed, because the
-- application reads them through the service role, which bypasses RLS
-- entirely. The gap was invisible from inside the product.
--
-- ── WHY ENABLING RLS WITH NO POLICY IS SAFE HERE ───────────────────────────
--
-- Every path that touches these tables uses createServiceClient (the service
-- role), and the service role bypasses RLS. The browser never queries
-- Supabase directly — the only client-side Supabase use in the codebase is a
-- storage upload for alumni photographs. So RLS with no policy denies anon
-- and authenticated, and changes nothing for the application.
--
-- Safe to run more than once.
-- ============================================================================

BEGIN;

ALTER TABLE webhook_inbox         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_fees          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_comments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketer_enrollments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_jobs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_events      ENABLE ROW LEVEL SECURITY;

-- Deliberately NO policies. Access is through the service role only, which is
-- how the application already reads every one of these. A policy added later
-- must be written against a real caller, not added to make something work.

COMMIT;

-- ============================================================================
-- AFTER RUNNING THIS
--
--   1. Re-run the check. It must report PASS:
--
--        node scripts/verify-rls.mjs
--
--   2. ROTATE THE WASENDERAPI SESSION KEYS. They have been readable by
--      anyone. Redaction landed on 22 Sep, so events before then still carry
--      them in webhook_inbox.raw — closing the table does not un-publish what
--      has already been served. See Trello CB-017.
--
--   3. Consider purging the historic rows:
--
--        UPDATE webhook_inbox SET raw = NULL WHERE created_at < '2026-09-22';
-- ============================================================================

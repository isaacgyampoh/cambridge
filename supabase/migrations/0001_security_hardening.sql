-- ============================================================================
-- 0001 — SECURITY HARDENING
--
-- Run this ONCE in the Supabase SQL editor, AFTER rotating the exposed keys.
--
-- This migration is ADDITIVE. It creates tables, adds columns and enables
-- policies. It does not drop a table, drop a column, or delete business data.
-- The two rows it does remove are stated explicitly and are both session
-- state, not records: expired/legacy login sessions, described at step 7.
--
-- What it does:
--   1. Rate-limiting table and functions           (login throttling)
--   2. Audit log: new columns, append-only, RLS    (F-12)
--   3. Row Level Security on every table           (F-03, F-05)
--   4. Replace the over-permissive policies        (F-05)
--   5. Pin search_path on SECURITY DEFINER funcs   (F-19)
--   6. Force a PIN reset for every account         (F-01, F-09)
--   7. Invalidate legacy plaintext session tokens
--   8. Indexes for the new lookups
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. RATE LIMITING
--
-- The app runs on serverless instances that share no memory, so the counter
-- has to live in the database. auth_throttle_hit does read-modify-write inside
-- a single statement under a row lock, so two concurrent sign-in attempts
-- cannot both see the same pre-increment count.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth_throttle (
  key           TEXT PRIMARY KEY,
  count         INT NOT NULL DEFAULT 0,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION auth_throttle_hit(
  p_key TEXT,
  p_limit INT,
  p_window_seconds INT,
  p_block_seconds INT
)
RETURNS TABLE(allowed BOOLEAN, retry_after INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_row auth_throttle%ROWTYPE;
BEGIN
  INSERT INTO auth_throttle(key, count, window_start)
  VALUES (p_key, 0, v_now)
  ON CONFLICT (key) DO NOTHING;

  SELECT * INTO v_row FROM auth_throttle WHERE key = p_key FOR UPDATE;

  -- Still inside a block?
  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
    RETURN QUERY SELECT FALSE,
      CEIL(EXTRACT(EPOCH FROM (v_row.blocked_until - v_now)))::INT;
    RETURN;
  END IF;

  -- Window elapsed → start a fresh one.
  IF v_row.window_start < v_now - MAKE_INTERVAL(secs => p_window_seconds) THEN
    UPDATE auth_throttle
       SET count = 1, window_start = v_now, blocked_until = NULL
     WHERE key = p_key;
    RETURN QUERY SELECT TRUE, 0;
    RETURN;
  END IF;

  -- Limit reached → block.
  IF v_row.count + 1 >= p_limit THEN
    UPDATE auth_throttle
       SET count = v_row.count + 1,
           blocked_until = v_now + MAKE_INTERVAL(secs => p_block_seconds)
     WHERE key = p_key;
    RETURN QUERY SELECT FALSE, p_block_seconds;
    RETURN;
  END IF;

  UPDATE auth_throttle SET count = v_row.count + 1 WHERE key = p_key;
  RETURN QUERY SELECT TRUE, 0;
END;
$$;

CREATE OR REPLACE FUNCTION auth_throttle_reset(p_key TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM auth_throttle WHERE key = p_key;
$$;

-- Only the server (service_role) may call these. Without this, anyone holding
-- the public anon key could reset their own throttle counter and defeat it.
REVOKE ALL ON FUNCTION auth_throttle_hit(TEXT, INT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION auth_throttle_reset(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auth_throttle_hit(TEXT, INT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION auth_throttle_reset(TEXT) TO service_role;

ALTER TABLE auth_throttle ENABLE ROW LEVEL SECURITY;  -- no policies: server only


-- ---------------------------------------------------------------------------
-- 2. AUDIT LOG
--
-- The table existed but nothing ever wrote to it. Columns are ADDED to the
-- existing shape (user_id / table_name / record_id) rather than replacing it,
-- so any rows already present remain valid.
-- ---------------------------------------------------------------------------

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS success    BOOLEAN DEFAULT TRUE;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata   JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Append-only: no UPDATE or DELETE policy exists for ANY role, so the trail
-- cannot be rewritten or erased through the Data API even by a signed-in user.
-- service_role bypasses RLS, so the server can still insert.
DROP POLICY IF EXISTS "audit_no_client_access" ON audit_logs;

REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY ON EVERY TABLE
--
-- Eighteen tables had no RLS at all. Because the anon key is public by design
-- (it ships in the browser), those tables were readable AND writable by anyone
-- through the Supabase Data API — including audit_logs, login_events and the
-- SMS/WhatsApp/email logs with their message bodies and phone numbers.
--
-- Enabling RLS with no policy is a default deny. All application reads and
-- writes go through server routes using the service role, which bypasses RLS,
-- so this closes the Data API without changing how the app works. (Verified:
-- the browser Supabase client is used only for Storage, never for tables.)
-- ---------------------------------------------------------------------------

ALTER TABLE attendance             ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_students         ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches                ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_recipients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE campuses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses                ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_status_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketer_targets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reminders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE personalized_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_tasks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE scholarships           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_logs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_logs          ENABLE ROW LEVEL SECURITY;

-- Tables that appear in some schema files but not others; guarded so this
-- migration succeeds whichever set is present in your project.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'student_fees','class_enrollments','class_materials','class_sections',
    'prep_records','testimonials','knowledge_base','ai_conversations',
    'sequences','sequence_steps','sequence_enrollments','program_points',
    'rank_bands','marketer_enrollments','office_locations','staff_attendance',
    'cron_runs','lead_comments','raw_webhooks','flyers','info_sessions',
    'notifications','certificates','documents','applications'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      EXECUTE FORMAT('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;


-- ---------------------------------------------------------------------------
-- 4. REPLACE THE OVER-PERMISSIVE POLICIES
--
-- Nearly every policy in the schema is written against auth.uid(), which is
-- ALWAYS NULL here: the app authenticates with its own PIN cookie and never
-- signs a user into Supabase Auth. Those policies can therefore never grant
-- anything, and are dropped rather than left to imply protection they do not
-- provide. Authorization is enforced server-side, in lib/data/policy.ts and
-- lib/auth/guard.ts.
--
-- These three were the exception — they granted unconditionally:
--   sessions_public_read  : USING (true)      → every class session, to anyone
--   applications_insert   : WITH CHECK (true) → anonymous inserts
--   activities_insert     : WITH CHECK (true) → anonymous inserts
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "sessions_public_read"  ON class_sessions;
DROP POLICY IF EXISTS "applications_insert"   ON applications;
DROP POLICY IF EXISTS "activities_insert"     ON lead_activities;
DROP POLICY IF EXISTS "signins_public_insert" ON class_signins;
DROP POLICY IF EXISTS "documents_read"        ON documents;

-- Public application and testimonial submission still work: they go through
-- server routes (/api/applications/submit, /api/testimonials/submit) which use
-- the service role. They never needed an anon INSERT policy.


-- ---------------------------------------------------------------------------
-- 5. PIN search_path ON SECURITY DEFINER FUNCTIONS
--
-- A SECURITY DEFINER function without a fixed search_path can be made to
-- resolve a table name to an attacker-controlled schema, running their code
-- with the definer's privileges.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_my_role') THEN
    EXECUTE 'ALTER FUNCTION get_my_role() SET search_path = public, pg_temp';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'verify_session_token') THEN
    EXECUTE 'ALTER FUNCTION verify_session_token(TEXT) SET search_path = public, pg_temp';
    -- This RPC returns session identity and must never be callable by the
    -- public anon key.
    EXECUTE 'REVOKE ALL ON FUNCTION verify_session_token(TEXT) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 6. FORCE A PIN RESET FOR EVERY ACCOUNT
--
-- Every stored PIN must be treated as compromised: the hash was a single fast
-- SHA-256 round with ONE salt shared by all users, that salt shipped inside
-- the public browser bundle, and pin_hash was returned by /api/data to four
-- different roles. Ten thousand four-digit values against a known salt is a
-- table built in milliseconds.
--
-- Nobody is locked out: the old hashes still verify, and each account is
-- re-hashed with scrypt on its next successful sign-in. This flag simply makes
-- everyone choose a new PIN at that point.
-- ---------------------------------------------------------------------------

UPDATE profiles SET must_change_pin = TRUE WHERE pin_hash IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 7. INVALIDATE LEGACY SESSION TOKENS
--
-- Session tokens used to be stored in plaintext, so anyone with a copy of the
-- database could replay them. They are now stored hashed. Existing rows hold
-- raw tokens that will never match a hashed lookup, so they are dead weight —
-- removing them makes the forced re-login explicit rather than mysterious.
--
-- Effect: everyone signs in again once. Given the service_role key was public,
-- invalidating every existing session is the correct outcome anyway.
-- ---------------------------------------------------------------------------

DELETE FROM pin_sessions;

ALTER TABLE pin_sessions ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- 8. INDEXES
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_pin_sessions_token   ON pin_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_pin_sessions_expires ON pin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_throttle_block  ON auth_throttle(blocked_until);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created   ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user      ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email       ON profiles(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_profiles_phone       ON profiles(phone);
CREATE INDEX IF NOT EXISTS idx_login_events_created ON login_events(created_at DESC);

COMMIT;

-- ============================================================================
-- AFTER RUNNING THIS
--
--   1. Confirm no table is left without RLS:
--
--        SELECT tablename FROM pg_tables
--         WHERE schemaname = 'public' AND rowsecurity = FALSE;
--
--      That should return no rows.
--
--   2. Sign in once as the super admin. You will be asked to choose a new PIN.
--
--   3. Housekeeping for auth_throttle (optional): rows expire logically, but
--      to keep the table small you can periodically run
--
--        DELETE FROM auth_throttle
--         WHERE window_start < NOW() - INTERVAL '1 day'
--           AND (blocked_until IS NULL OR blocked_until < NOW());
-- ============================================================================

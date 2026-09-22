-- ============================================================================
-- CAMBRIDGE CENTRE OF EXCELLENCE — ALL PENDING MIGRATIONS, IN ORDER
--
-- HOW TO RUN THIS
--
--   1. Open the Supabase dashboard for this project
--   2. SQL Editor  ->  New query
--   3. Paste this entire file
--   4. Run
--
-- It is SAFE TO RUN MORE THAN ONCE. Every table is CREATE TABLE IF NOT
-- EXISTS, every function is CREATE OR REPLACE, every index is CREATE INDEX IF
-- NOT EXISTS, every new column is ADD COLUMN IF NOT EXISTS, and the one data
-- migration rewrites URLs to a form that is unchanged by rewriting it again.
-- Nothing here drops anything or deletes a row.
--
-- WHAT EACH PART DOES
--
--   0018  Atomic counters, so two simultaneous events cannot lose one of them.
--   0019  Marketing visit tracking for the /m/ links.
--   0020  Rewrites stored public URLs onto the canonical domain.
--   0021  Lead distribution: the configured shares, the persistent weighted
--         scheduler state, and the columns that record why each lead went
--         where it went.
--
-- UNTIL 0021 IS APPLIED, lead distribution runs on the previous engine and
-- the Lead distribution screen says so at the top. Nothing breaks either way.
-- ============================================================================


-- ===========================================================================
-- 0018_atomic_counters
-- ===========================================================================

-- ============================================================================
-- 0018 — COUNT THINGS ONCE, EVEN WHEN THEY HAPPEN AT THE SAME TIME
--
-- Run AFTER 0017. Additive: one function. No table, column or row is changed.
--
-- WHY
--
-- Three counters in the application are kept by reading a number, adding one
-- to it in JavaScript, and writing the result back:
--
--     flyers.clicks           every view of a public flyer
--     flyers.leads            every enquiry a flyer produces
--     referral_codes.referrals_count
--
-- Two people opening the same flyer in the same second both read 40, both
-- write 41, and one of the views is gone. There is no error, nothing in a
-- log, and no way to notice afterwards — the number is simply lower than the
-- truth, and it drifts further the better a flyer is doing. The one campaign
-- being shared hardest is the one whose figures are worst, which is precisely
-- backwards from what the marketer needs.
--
-- A read-modify-write cannot be made safe from the application side. Postgres
-- can do the whole thing in one statement, under the row lock it already
-- takes for the UPDATE, so no two callers can interleave.
--
-- WHY A FUNCTION RATHER THAN A RAW UPDATE
--
-- PostgREST cannot express `SET clicks = clicks + 1` — it sends values, not
-- expressions. An RPC is the supported way to run one, and this codebase
-- already keeps its atomic operations that way: assign_lead_atomic,
-- record_payment_once, claim_event, next_admission_number, auth_throttle_hit.
-- This is the same pattern, not a new one.
--
-- SAFETY
--
-- The table name is checked against a fixed allowlist rather than
-- interpolated freely, so the function cannot be used to increment an
-- arbitrary column anywhere in the schema. COALESCE covers rows whose counter
-- was never initialised — those are NULL, and NULL + 1 is NULL, which would
-- quietly erase a count instead of raising it.
--
-- The application works whether or not this has been run: bump_counter is
-- called first and the old read-then-write is used only if the function is
-- missing, exactly as rateLimit does with auth_throttle_hit. Applying this
-- migration turns the fallback off; it does not switch anything on.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION bump_counter(
  p_table  TEXT,
  p_column TEXT,
  p_id     UUID,
  p_by     INTEGER DEFAULT 1
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new BIGINT;
BEGIN
  -- An allowlist, not interpolation. Anything else is refused outright.
  IF NOT (
    (p_table = 'flyers'          AND p_column IN ('clicks', 'leads')) OR
    (p_table = 'referral_codes'  AND p_column = 'referrals_count')
  ) THEN
    RAISE EXCEPTION 'bump_counter: %.% is not a countable column', p_table, p_column;
  END IF;

  -- One statement. The row lock the UPDATE takes is what makes concurrent
  -- callers queue rather than overwrite one another.
  EXECUTE format(
    'UPDATE %I SET %I = COALESCE(%I, 0) + $1 WHERE id = $2 RETURNING %I',
    p_table, p_column, p_column, p_column
  )
  INTO v_new
  USING p_by, p_id;

  -- NULL means no such row. The caller treats that as "nothing counted",
  -- which is true, rather than as a failure to retry.
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION bump_counter(TEXT, TEXT, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bump_counter(TEXT, TEXT, UUID, INTEGER) TO service_role;

COMMIT;


-- ===========================================================================
-- 0019_marketing_visits
-- ===========================================================================

-- ============================================================================
-- 0019 — WHO OPENED A STAFF MARKETING LINK, WITHOUT KNOWING WHO THEY ARE
--
-- Run AFTER 0018. Additive: one table, three indexes. Nothing else changes.
--
-- WHY
--
-- /m/{code} is the permanent link a member of staff puts on a flyer, a QR
-- code or an Instagram bio. Leads and registrations that come from it are
-- already attributed — the existing application flow does that. What nothing
-- records is the step before: somebody opened it and did not register.
--
-- Without that, a marketer cannot tell a link nobody clicks from a link many
-- people click and leave. Those need opposite responses — share it somewhere
-- else, or fix what the page says — and the two are indistinguishable when
-- the only number is registrations.
--
-- WHAT IS DELIBERATELY NOT STORED
--
-- No IP address, no user agent, no cookie that survives the visit, and
-- nothing that could later be joined to a person. A click is not consent and
-- an open link is not an identity: somebody who reads a flyer and closes it
-- has told the centre nothing about themselves, and this table must not
-- pretend otherwise.
--
-- session_id is a random value the browser makes up for one visit. It exists
-- so that opening the same link twice in a minute is not counted as two
-- people — not so anybody can be followed. It is meaningless outside this
-- table and is never joined to leads.
--
-- Personal details arrive only through the registration form, on the existing
-- path, where the person has typed them in on purpose.
--
-- RETENTION
--
-- Ninety days. Long enough to compare this month with last; short enough that
-- a table of anonymous browsing does not accumulate for ever. 0007_retention
-- established the pattern and prune_old_logs is where this is swept.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS marketing_visits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The link that was opened. Deliberately the CODE and not a profile id:
  -- the code is already public (it is in the URL), and storing the id would
  -- put an internal identifier in a table written by an anonymous request.
  marketer_code TEXT NOT NULL,

  -- Random, per visit, from the browser. Not a person.
  session_id  TEXT NOT NULL,

  -- What they were shown, so a marketer can see which promotion drew people.
  -- Null when nothing was scheduled and the page listed programmes instead.
  course_id   UUID REFERENCES courses(id) ON DELETE SET NULL,

  -- Where they came from, host only, for "Instagram or WhatsApp?". Never the
  -- full URL: a referring address can itself carry personal information.
  referrer_host TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per session per link per day. The beacon fires on every page view,
-- so without this a person refreshing twice is two visits.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_visits_once
  ON marketing_visits (marketer_code, session_id, (created_at::date));

-- "How is MY link doing" — the marketer's own panel.
CREATE INDEX IF NOT EXISTS idx_marketing_visits_code
  ON marketing_visits (marketer_code, created_at DESC);

-- The admin comparison across staff.
CREATE INDEX IF NOT EXISTS idx_marketing_visits_created
  ON marketing_visits (created_at DESC);

-- Written by the service role only, through /api/marketing/visit. No browser
-- reaches this table directly, and nothing reads it without a session.
ALTER TABLE marketing_visits ENABLE ROW LEVEL SECURITY;

COMMIT;


-- ===========================================================================
-- 0020_canonical_public_urls
-- ===========================================================================

-- ============================================================================
-- 0020 — STORED LINKS NAME THE CENTRE, NOT A DEPLOYMENT
--
-- Run AFTER 0019. Data only: no table, column, index or policy changes.
--
-- WHY
--
-- The brochure links on the public front page read
--
--     https://cambridge-mu.vercel.app/brochures/pmp-brochure.pdf
--
-- No code builds those. They are stored absolute, written while
-- NEXT_PUBLIC_APP_URL pointed at a deployment alias — so fixing the code could
-- not reach them, because the code was never what produced them.
--
-- A marketer shares a brochure with a customer and it carries an address that
-- says nothing about Cambridge, works only while that alias happens to exist,
-- and looks exactly like the kind of link people are told not to open.
--
-- WHAT IS CHANGED, AND WHAT IS NOT
--
-- Only the ORIGIN, and only when it is this application under another name: a
-- *.vercel.app deployment, or a localhost address written by a developer's
-- build. The path, query and fragment are preserved exactly.
--
-- Cloudinary, Supabase storage and every other genuine third-party host are
-- left completely alone. They are not this application and their addresses are
-- correct.
--
-- SAFETY
--
-- The application does not depend on this migration. canonicalisePublicUrl in
-- lib/url.ts already repairs these on the way out, so every link is correct
-- whether or not this has been run. This makes the stored data match what is
-- being served, so the next person to read the table is not misled.
--
-- Idempotent: running it twice changes nothing the second time, because the
-- rows no longer match the WHERE clause.
-- ============================================================================

BEGIN;

-- Course brochures — the ones on the public front page.
UPDATE courses
SET brochure_url = 'https://portal.cambridge.edu.gh'
  || regexp_replace(brochure_url, '^https?://[^/]+', '')
WHERE brochure_url ~ '^https?://([^/]*\.)?vercel\.app/'
   OR brochure_url ~ '^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/';

-- Flyer artwork. Most is on Cloudinary and is untouched by the WHERE clause;
-- anything uploaded to the application's own public folder is not.
UPDATE flyers
SET image_url = 'https://portal.cambridge.edu.gh'
  || regexp_replace(image_url, '^https?://[^/]+', '')
WHERE image_url ~ '^https?://([^/]*\.)?vercel\.app/'
   OR image_url ~ '^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/';

-- Documents: admission letters, certificates, brochures sent on WhatsApp.
UPDATE documents
SET file_url = 'https://portal.cambridge.edu.gh'
  || regexp_replace(file_url, '^https?://[^/]+', '')
WHERE file_url ~ '^https?://([^/]*\.)?vercel\.app/'
   OR file_url ~ '^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/';

COMMIT;


-- ===========================================================================
-- 0021_lead_distribution
-- ===========================================================================

-- ============================================================================
-- LEAD DISTRIBUTION AS A CONFIGURED FEATURE
--
-- ── WHAT WAS ACTUALLY WRONG ────────────────────────────────────────────────
--
-- There were no configured percentages. Selection weight came from one of
-- four hard-coded performance tiers (high 45, mid 35, low/support 20), and
-- nothing in the portal could set a person's share of incoming leads.
--
-- Worse, the weight was not applied to the share of new leads at all.
-- assign_lead_atomic ordered candidates by
--
--     open_leads / weight
--
-- where open_leads counted leads not yet registered, lost or written off. So
-- clearing your pipeline lowered your score and won you the next lead, and
-- letting leads sit raised it and starved you. Who received what was decided
-- by working speed, not by any configured number.
--
-- And the lock was on the wrong row. `SELECT ... FROM leads WHERE id = ?
-- FOR UPDATE` serialises two assignments OF THE SAME LEAD, which is not the
-- contended case. Two DIFFERENT leads arriving together locked different
-- rows, both read the same load snapshot, and both picked the same person.
-- A burst of enquiries — exactly what a campaign produces — landed on one
-- marketer.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
-- One new table holding each member's configured share and their carried
-- allocation state, and one function that picks and claims under a lock over
-- the MEMBER rows, which is the resource actually contended.
--
-- lead_assignments already existed and already recorded every assignment, so
-- it is extended rather than duplicated. There is no second history table.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. WHO IS IN THE SHARED POOL, AND FOR WHAT SHARE
--
-- profile_id is the PRIMARY KEY, so a person cannot appear twice. That is the
-- "duplicate staff entries are impossible" rule expressed where it cannot be
-- bypassed, rather than as a check in one screen.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_distribution_members (
  profile_id         UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,

  allocation_percent NUMERIC(6,2) NOT NULL DEFAULT 0
                     CHECK (allocation_percent >= 0 AND allocation_percent <= 100),

  -- The distribution switch, separate from whether the person is employed.
  -- A profile that is deactivated stops receiving leads regardless of this.
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,

  -- Smooth weighted round-robin state: accumulated allocation debt. This is
  -- the whole reason distribution survives a deployment. It must never be
  -- held in process memory, because a second instance would then distribute
  -- from its own private idea of who is owed what.
  current_weight     NUMERIC(14,4) NOT NULL DEFAULT 0,

  leads_received     INTEGER NOT NULL DEFAULT 0,
  last_assigned_at   TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by         UUID REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ldm_active
  ON lead_distribution_members(is_active) WHERE is_active;

-- ---------------------------------------------------------------------------
-- 2. WHY EACH LEAD WENT WHERE IT WENT
--
-- Extending the table that already holds this rather than adding a parallel
-- one. Every column is nullable: rows written before this migration are
-- history and are never rewritten.
-- ---------------------------------------------------------------------------
ALTER TABLE lead_assignments
  ADD COLUMN IF NOT EXISTS method               TEXT,
  ADD COLUMN IF NOT EXISTS weight_at_assignment NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS pool_size            INTEGER,
  ADD COLUMN IF NOT EXISTS campaign             TEXT,
  ADD COLUMN IF NOT EXISTS notified             BOOLEAN,
  ADD COLUMN IF NOT EXISTS notify_error         TEXT;

COMMENT ON COLUMN lead_assignments.method IS
  'weighted | direct_attribution | equal_fallback | manual | reassign';

CREATE INDEX IF NOT EXISTS idx_lead_assignments_to_created
  ON lead_assignments(to_marketer, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_created
  ON lead_assignments(created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. PICK AND CLAIM, UNDER A LOCK ON THE CONTENDED RESOURCE
--
-- p_eligible carries the ids the application has already established may hold
-- a lead, because that test depends on resolved portals and is owned by
-- lib/access/portals. This function decides SHARE; it does not re-implement
-- eligibility, so the two cannot drift apart.
--
-- Returns the chosen marketer, the weight that decided it, the pool size and
-- the method — all recorded against the assignment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION distribute_lead_weighted(
  p_lead_id  UUID,
  p_eligible UUID[],
  p_actor    UUID DEFAULT NULL,
  p_source   TEXT DEFAULT NULL,
  p_campaign TEXT DEFAULT NULL
)
RETURNS TABLE (chosen UUID, weight NUMERIC, pool INTEGER, method TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current   UUID;
  v_total     NUMERIC;
  v_chosen    UUID;
  v_weight    NUMERIC;
  v_pool      INTEGER;
  v_method    TEXT;
BEGIN
  IF p_eligible IS NULL OR array_length(p_eligible, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Idempotence: a lead that already has an owner keeps it. Retried webhooks
  -- and duplicate deliveries must not reshuffle ownership.
  SELECT assigned_to INTO v_current FROM leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_current IS NOT NULL THEN
    RETURN QUERY SELECT v_current, NULL::NUMERIC, NULL::INTEGER, 'already_assigned'::TEXT;
    RETURN;
  END IF;

  /*
   * THE LOCK THAT MATTERS.
   *
   * Every concurrent allocation reads and then rewrites the same scheduler
   * state, so the read-decide-write cycle has to be serialised. Two leads
   * arriving in the same millisecond now queue here, and the second one sees
   * the state the first one wrote instead of both choosing from the same
   * stale snapshot — which is how a campaign burst used to land on one
   * marketer.
   *
   * A transaction-scoped ADVISORY lock rather than row locks on the member
   * table. Both serialise correctly; this one is chosen because it cannot
   * deadlock — there is exactly one lock and it is always taken first — and
   * because it does not depend on which rows a particular candidate set
   * happens to touch. A caller allocating among a source-restricted subset
   * still waits for one allocating among everybody, which is right: the
   * state they share is the whole table, not the rows they read from it.
   *
   * It is released automatically when the transaction ends, including on
   * error, so a failed allocation cannot wedge the queue.
   */
  PERFORM pg_advisory_xact_lock(hashtext('lead_distribution_allocation'));

  SELECT COALESCE(SUM(m.allocation_percent), 0), COUNT(*)
    INTO v_total, v_pool
    FROM lead_distribution_members m
    JOIN profiles p ON p.id = m.profile_id
   WHERE m.profile_id = ANY(p_eligible)
     AND m.is_active
     AND p.is_active
     AND m.allocation_percent > 0;

  IF v_total > 0 THEN
    -- Smooth weighted round-robin: accrue, take the maximum, pay the pool.
    UPDATE lead_distribution_members m
       SET current_weight = m.current_weight + m.allocation_percent
      FROM profiles p
     WHERE p.id = m.profile_id
       AND m.profile_id = ANY(p_eligible)
       AND m.is_active AND p.is_active
       AND m.allocation_percent > 0;

    SELECT m.profile_id, m.allocation_percent
      INTO v_chosen, v_weight
      FROM lead_distribution_members m
      JOIN profiles p ON p.id = m.profile_id
     WHERE m.profile_id = ANY(p_eligible)
       AND m.is_active AND p.is_active
       AND m.allocation_percent > 0
     ORDER BY m.current_weight DESC, m.profile_id ASC
     LIMIT 1;

    UPDATE lead_distribution_members
       SET current_weight = current_weight - v_total
     WHERE profile_id = v_chosen;

    v_method := 'weighted';
  ELSE
    /*
     * Nobody is configured yet. Introducing this feature must not stop leads
     * being assigned, so the pool falls back to an equal share among the
     * eligible — the behaviour a manager would expect from an unconfigured
     * system — and says so in the method, which is what the dashboard reads
     * to warn that distribution is unconfigured.
     *
     * Least-recently-assigned, so the fallback still rotates rather than
     * repeatedly picking the same person.
     */
    SELECT p.id INTO v_chosen
      FROM profiles p
      LEFT JOIN lead_distribution_members m ON m.profile_id = p.id
     WHERE p.id = ANY(p_eligible)
       AND p.is_active
       AND COALESCE(m.is_active, TRUE)
     ORDER BY COALESCE(m.last_assigned_at, TIMESTAMPTZ 'epoch') ASC, p.id ASC
     LIMIT 1;

    v_weight := NULL;
    v_method := 'equal_fallback';
    SELECT COUNT(*) INTO v_pool FROM profiles p
      WHERE p.id = ANY(p_eligible) AND p.is_active;
  END IF;

  IF v_chosen IS NULL THEN
    RETURN;
  END IF;

  UPDATE leads
     SET assigned_to = v_chosen,
         assigned_at = NOW()
   WHERE id = p_lead_id;

  -- Keep the counters on the row that decides the next pick, so the dashboard
  -- and the scheduler cannot disagree about what happened.
  INSERT INTO lead_distribution_members (profile_id, leads_received, last_assigned_at)
  VALUES (v_chosen, 1, NOW())
  ON CONFLICT (profile_id) DO UPDATE
     SET leads_received   = lead_distribution_members.leads_received + 1,
         last_assigned_at = NOW();

  INSERT INTO lead_assignments
    (lead_id, from_marketer, to_marketer, assigned_by, reason, source,
     method, weight_at_assignment, pool_size, campaign)
  VALUES
    (p_lead_id, NULL, v_chosen, p_actor, 'auto', p_source,
     v_method, v_weight, v_pool, p_campaign);

  RETURN QUERY SELECT v_chosen, v_weight, v_pool, v_method;
END;
$$;

REVOKE ALL ON FUNCTION distribute_lead_weighted(UUID, UUID[], UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION distribute_lead_weighted(UUID, UUID[], UUID, TEXT, TEXT)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. RECORD WHETHER THE NOTIFICATION ACTUALLY WENT
--
-- Assignment and notification are separate outcomes. A failed text must never
-- unassign a lead, and must never be recorded as delivered.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_assignment_notification(
  p_lead_id UUID,
  p_marketer UUID,
  p_ok BOOLEAN,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE lead_assignments
     SET notified = p_ok, notify_error = p_error
   WHERE id = (
     SELECT id FROM lead_assignments
      WHERE lead_id = p_lead_id AND to_marketer = p_marketer
      ORDER BY created_at DESC LIMIT 1
   );
$$;

REVOKE ALL ON FUNCTION record_assignment_notification(UUID, UUID, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_assignment_notification(UUID, UUID, BOOLEAN, TEXT)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS — the table is read and written through the service role only
-- ---------------------------------------------------------------------------
ALTER TABLE lead_distribution_members ENABLE ROW LEVEL SECURITY;
-- No policy for anon/authenticated: every read and write goes through the
-- application's own role checks in /api/leads/distribution.

COMMIT;

-- ============================================================================
-- AFTER RUNNING THIS
--
--   Nobody is configured yet, so distribution runs in equal_fallback until
--   somebody sets shares on Settings -> Lead distribution. That is deliberate:
--   leads keep flowing, and the dashboard shows the unconfigured state
--   plainly rather than silently inventing percentages.
--
--   Leads currently held by somebody with no leads page are the ones that
--   "disappeared". They are NOT touched by this migration — reassignment is a
--   business decision, and the Lead inbox has a safe mechanism for it:
--
--     SELECT l.id, l.full_name, p.full_name AS holder, p.role
--       FROM leads l JOIN profiles p ON p.id = l.assigned_to
--      WHERE p.is_active = FALSE;
-- ============================================================================


-- ===========================================================================
-- 0022_processed_events_source
-- ===========================================================================

-- ============================================================================
-- THE PAYSTACK WEBHOOK IS FAILING: processed_events HAS NO `source` COLUMN
--
-- Seen in production logs on 2026-09-22:
--
--   [paystack] claim_event failed: column "source" of relation
--   "processed_events" does not exist        -> POST /api/webhooks/paystack 503
--
-- Migration 0004 defines processed_events WITH a source column, but uses
-- CREATE TABLE IF NOT EXISTS — and the table already existed in an older
-- shape, so the statement was skipped and the column never added. claim_event
-- inserts it, fails, and every webhook is answered 503.
--
-- Paystack retries 503s, and payments are also confirmed by the callback and
-- the hourly reconcile, so money is not lost — but the webhook, the fastest
-- and most reliable of the three, is doing nothing.
--
-- Safe to run more than once.
-- ============================================================================

ALTER TABLE processed_events ADD COLUMN IF NOT EXISTS source TEXT;

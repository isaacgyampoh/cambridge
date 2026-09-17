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
   * Every concurrent allocation contends for these rows, so taking them FOR
   * UPDATE serialises the read-decide-write cycle across all of them. Two
   * leads arriving in the same millisecond now queue here and the second one
   * sees the state the first one wrote, instead of both choosing from the
   * same stale snapshot.
   *
   * Ordered by profile_id so concurrent callers take the rows in the same
   * order and cannot deadlock against each other.
   */
  PERFORM 1 FROM lead_distribution_members m
    JOIN profiles p ON p.id = m.profile_id
   WHERE m.profile_id = ANY(p_eligible)
     AND m.is_active
     AND p.is_active
   ORDER BY m.profile_id
     FOR UPDATE OF m;

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

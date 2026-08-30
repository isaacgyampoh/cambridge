-- ============================================================================
-- 0002 — LEAD ASSIGNMENT: ATOMICITY AND HISTORY
--
-- Run AFTER 0001_security_hardening.sql.
-- Additive: creates one table, two functions and three indexes. No data is
-- deleted and no column is dropped.
--
-- Fixes:
--   * assignment was read-then-write with no lock, so two leads arriving
--     together could both be handed to the same person from the same stale
--     load figures
--   * there was no record of who assigned what, when, or from whom
--   * lead_assign_pending was incremented with a read-then-write, losing
--     counts under concurrency
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ASSIGNMENT HISTORY
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lead_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_marketer   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  to_marketer     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- NULL = automatic
  reason          TEXT NOT NULL DEFAULT 'auto',   -- auto | manual | reassign | claim
  source          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead ON lead_assignments(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_to   ON lead_assignments(to_marketer, created_at DESC);

ALTER TABLE lead_assignments ENABLE ROW LEVEL SECURITY;  -- server-only, as with every other table


-- ---------------------------------------------------------------------------
-- 2. ATOMIC ASSIGNMENT
--
-- Eligibility is decided in TypeScript (lib/leads/eligibility.ts) because it
-- depends on the portal rules that also drive the navigation and the route
-- guard — duplicating those in SQL would guarantee drift. The candidate ids
-- and their weights are therefore passed IN, and this function's job is the
-- part that must be atomic: choosing among them and claiming the lead in a
-- single locked step.
--
-- Selection is weighted least-loaded: the lowest open-lead count divided by
-- tier weight wins. Over time that matches the tier proportions, and unlike
-- the previous Math.random() lottery it cannot starve anyone — a marketer
-- holding no leads always scores zero, the minimum, so they take the next one.
-- Ties break on the longest wait since a previous assignment, then on id, so
-- the outcome is deterministic and reproducible.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION assign_lead_atomic(
  p_lead_id    UUID,
  p_candidates UUID[],
  p_weights    INT[],
  p_actor      UUID DEFAULT NULL,
  p_reason     TEXT DEFAULT 'auto',
  p_source     TEXT DEFAULT NULL,
  p_force      BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current  UUID;
  v_chosen   UUID;
BEGIN
  IF p_candidates IS NULL OR array_length(p_candidates, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  -- Lock the lead. A second concurrent assignment for the same lead waits
  -- here, then sees the assignment this one made.
  SELECT assigned_to INTO v_current
    FROM leads WHERE id = p_lead_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Already assigned and not a deliberate reassignment: return what is there.
  -- This makes repeat calls idempotent rather than reshuffling ownership.
  IF v_current IS NOT NULL AND NOT p_force THEN
    RETURN v_current;
  END IF;

  -- Weighted least-loaded choice among the supplied candidates.
  WITH candidate AS (
    SELECT c.id, GREATEST(w.weight, 1) AS weight
      FROM unnest(p_candidates) WITH ORDINALITY AS c(id, ord)
      JOIN unnest(p_weights)    WITH ORDINALITY AS w(weight, ord) USING (ord)
  ),
  load AS (
    SELECT c.id,
           c.weight,
           COALESCE(COUNT(l.id), 0) AS open_leads,
           COALESCE(MAX(l.assigned_at), TIMESTAMPTZ 'epoch') AS last_assigned
      FROM candidate c
      LEFT JOIN leads l
        ON l.assigned_to = c.id
       AND l.status NOT IN ('registered', 'lost', 'not_interested')
     GROUP BY c.id, c.weight
  )
  SELECT id INTO v_chosen
    FROM load
   ORDER BY (open_leads::NUMERIC / weight) ASC, last_assigned ASC, id ASC
   LIMIT 1;

  IF v_chosen IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE leads
     SET assigned_to = v_chosen,
         assigned_at = NOW()
   WHERE id = p_lead_id;

  INSERT INTO lead_assignments (lead_id, from_marketer, to_marketer, assigned_by, reason, source)
  VALUES (p_lead_id, v_current, v_chosen, p_actor, p_reason, p_source);

  RETURN v_chosen;
END;
$$;

REVOKE ALL ON FUNCTION assign_lead_atomic(UUID, UUID[], INT[], UUID, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION assign_lead_atomic(UUID, UUID[], INT[], UUID, TEXT, TEXT, BOOLEAN)
  TO service_role;


-- ---------------------------------------------------------------------------
-- 3. ASSIGN A LEAD TO A NAMED PERSON, ATOMICALLY
--
-- Used for manual assignment, reassignment, and personal referral links.
-- Returns TRUE when this call is the one that made the change.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION assign_lead_to(
  p_lead_id  UUID,
  p_marketer UUID,
  p_actor    UUID DEFAULT NULL,
  p_reason   TEXT DEFAULT 'manual',
  p_source   TEXT DEFAULT NULL,
  p_force    BOOLEAN DEFAULT TRUE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current UUID;
BEGIN
  SELECT assigned_to INTO v_current FROM leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Claiming an unclaimed lead: only the first caller succeeds.
  IF v_current IS NOT NULL AND NOT p_force THEN
    RETURN FALSE;
  END IF;

  IF v_current IS NOT DISTINCT FROM p_marketer THEN
    RETURN FALSE;   -- already theirs; nothing to record
  END IF;

  UPDATE leads SET assigned_to = p_marketer, assigned_at = NOW() WHERE id = p_lead_id;

  INSERT INTO lead_assignments (lead_id, from_marketer, to_marketer, assigned_by, reason, source)
  VALUES (p_lead_id, v_current, p_marketer, p_actor, p_reason, p_source);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION assign_lead_to(UUID, UUID, UUID, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION assign_lead_to(UUID, UUID, UUID, TEXT, TEXT, BOOLEAN) TO service_role;


-- ---------------------------------------------------------------------------
-- 4. ATOMIC PENDING-SMS COUNTER
--
-- Was read-then-write in application code, so two assignments landing together
-- both read the same value and one increment was lost. A single upsert with
-- an expression makes it exact.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lead_assign_pending (
  marketer_id  UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  pending      INT NOT NULL DEFAULT 0,
  last_lead_at TIMESTAMPTZ
);

ALTER TABLE lead_assign_pending ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION bump_lead_pending(p_marketer UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO lead_assign_pending (marketer_id, pending, last_lead_at)
  VALUES (p_marketer, 1, NOW())
  ON CONFLICT (marketer_id) DO UPDATE
    SET pending = lead_assign_pending.pending + 1,
        last_lead_at = NOW();
$$;

REVOKE ALL ON FUNCTION bump_lead_pending(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION bump_lead_pending(UUID) TO service_role;


-- ---------------------------------------------------------------------------
-- 5. INDEXES FOR THE ASSIGNMENT AND VISIBILITY QUERIES
-- ---------------------------------------------------------------------------

-- The load count in assign_lead_atomic, and every marketer's "my leads" view.
CREATE INDEX IF NOT EXISTS idx_leads_assigned_status ON leads(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_leads_unassigned      ON leads(created_at DESC) WHERE assigned_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_phone           ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_email           ON leads(email);

COMMIT;

-- ============================================================================
-- AFTER RUNNING THIS
--
--   Check who is actually eligible to receive leads. Anyone listed here who
--   should not be receiving leads has a portal configuration to correct:
--
--     SELECT full_name, role, in_lead_pool, portals
--       FROM profiles
--      WHERE is_active AND role <> 'super_admin'
--        AND (in_lead_pool IS DISTINCT FROM FALSE);
--
--   And find leads currently sitting with someone who has no leads portal —
--   these are the ones that "disappeared" and need redistributing from
--   Leads → Assign unassigned:
--
--     SELECT l.id, l.full_name, p.full_name AS holder, p.role
--       FROM leads l JOIN profiles p ON p.id = l.assigned_to
--      WHERE p.role IN ('trainer','accountant','receptionist','student',
--                       'exam_coordinator','content_manager');
-- ============================================================================

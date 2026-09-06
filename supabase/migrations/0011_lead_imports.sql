-- ============================================================================
-- 0011 — IMPORT BATCHES, AND ONBOARDING OFF THE IMPORT'S CRITICAL PATH
--
-- Run AFTER 0010. Additive: two tables, one function, indexes. Nothing dropped.
--
-- ── THE ROOT CAUSE THIS EXISTS TO FIX ──────────────────────────────────────
--
-- "When a list is imported, some staff receive leads and some do not."
--
-- It is not a UI refresh problem and not the assignment algorithm. The import
-- endpoint did the whole of onboarding INLINE, per lead, serially:
--
--     dedupe query → insert → eligibility query → assign RPC →
--     notification insert → counter RPC → sequence queries →
--     WhatsApp "hello" → WhatsApp gallery/brochure → AI opening message
--
-- Measured on this database, from a real import on 27 August:
--
--     window 12:24:42 → 12:28:51   (249 seconds)
--     22 leads imported
--     22 welcome_hello jobs created
--     44 WhatsApp sends            (two per lead)
--
--     = 11.3 seconds per lead
--
-- The browser posts batches of 20, so one request needs ~226 seconds. The
-- route declares no maxDuration, so it gets the platform default — 10 to 15
-- seconds. The function is killed a lead or two in.
--
-- Everything written before the kill STAYS written, because each lead is its
-- own set of statements with no surrounding transaction. The browser sees a
-- dead request and counts all twenty as failed. So:
--
--   * the reported totals are fiction — "20 failed" when six were imported
--   * whoever the first few leads went to receives leads; nobody else does
--   * the operator retries, dedupe makes retries quicker, more get through,
--     and the duplicate count inflates on every attempt
--
-- The fix is architectural: an import does the fast, transactional part
-- (validate, dedupe, insert, assign) and QUEUES the slow part. The queue is
-- drained by the existing cron worker, exactly as SMS is.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. THE IMPORT ITSELF
--
-- One row per import, so a number the operator was shown can be traced back to
-- what actually happened. `reference` is the human handle — IMPORT-20260906-0007
-- — carried into every lead, job and log line the import produces.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lead_imports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     TEXT UNIQUE NOT NULL,
  imported_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  filename      TEXT,

  -- Every row is accounted for: received = valid + invalid, and
  -- valid = assigned + unassigned + duplicates + failed.
  total_received INT NOT NULL DEFAULT 0,
  valid          INT NOT NULL DEFAULT 0,
  invalid        INT NOT NULL DEFAULT 0,
  duplicates     INT NOT NULL DEFAULT 0,
  assigned       INT NOT NULL DEFAULT 0,
  unassigned     INT NOT NULL DEFAULT 0,
  failed         INT NOT NULL DEFAULT 0,

  status        TEXT NOT NULL DEFAULT 'running',   -- running | complete | partial
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- 2. PER-ROW OUTCOMES
--
-- The counters above say how many failed. This says WHICH, and why — without
-- it, "12 failed" is a number nobody can act on.
--
-- The row's own data is kept so a failure can be corrected and retried without
-- the operator hunting for the original spreadsheet.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lead_import_rows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id   UUID NOT NULL REFERENCES lead_imports(id) ON DELETE CASCADE,
  row_number  INT NOT NULL,               -- as it appeared in the file
  lead_id     UUID REFERENCES leads(id) ON DELETE SET NULL,

  outcome     TEXT NOT NULL,              -- assigned | unassigned | duplicate | invalid | failed
  reason      TEXT,                       -- why, in words, for anything not assigned
  payload     JSONB,                      -- the submitted row, for retry

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_rows_import  ON lead_import_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_outcome ON lead_import_rows(import_id, outcome);
CREATE INDEX IF NOT EXISTS idx_lead_imports_ref    ON lead_imports(reference);
CREATE INDEX IF NOT EXISTS idx_lead_imports_when   ON lead_imports(started_at DESC);

ALTER TABLE lead_imports     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_import_rows ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. HUMAN-READABLE REFERENCES
--
-- IMPORT-20260906-0007. Sequential within the day, allocated under a lock so
-- two concurrent imports cannot take the same one.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION next_import_reference()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day   TEXT := TO_CHAR(NOW(), 'YYYYMMDD');
  v_count INT;
BEGIN
  -- Serialises reference allocation across concurrent imports.
  PERFORM pg_advisory_xact_lock(hashtext('lead_import_reference'));

  SELECT COUNT(*) + 1 INTO v_count
    FROM lead_imports
   WHERE reference LIKE 'IMPORT-' || v_day || '-%';

  RETURN 'IMPORT-' || v_day || '-' || LPAD(v_count::TEXT, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION next_import_reference() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION next_import_reference() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. ONBOARDING QUEUE
--
-- The welcome pack, the AI opening and the nurture enrolment move here. Each
-- is two WhatsApp round trips and an AI call — eleven seconds a lead — which
-- is what made a twenty-lead batch outlive its own request.
--
-- Claimed with SKIP LOCKED so overlapping cron runs take disjoint work rather
-- than both greeting the same lead.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lead_onboarding_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  marketer_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  source        TEXT,
  import_ref    TEXT,                     -- ties a greeting back to its import

  status        TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed
  attempts      INT NOT NULL DEFAULT 0,
  max_attempts  INT NOT NULL DEFAULT 3,
  next_run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error    TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);

-- One live onboarding per lead. A re-import must not greet somebody twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_one_per_lead
  ON lead_onboarding_queue(lead_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_onboarding_due
  ON lead_onboarding_queue(next_run_at)
  WHERE status IN ('queued', 'failed');

ALTER TABLE lead_onboarding_queue ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION claim_due_onboarding(p_limit INT DEFAULT 10)
RETURNS SETOF lead_onboarding_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE lead_onboarding_queue
     SET status = 'running', attempts = attempts + 1
   WHERE id IN (
     SELECT id FROM lead_onboarding_queue
      WHERE status IN ('queued', 'failed')
        AND attempts < max_attempts
        AND next_run_at <= NOW()
      ORDER BY created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION claim_due_onboarding(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_due_onboarding(INT) TO service_role;

COMMIT;

-- ============================================================================
-- WHAT TO LOOK AT AFTER AN IMPORT
--
--   Every row accounted for — the two sides must agree:
--     SELECT reference, total_received,
--            valid + invalid AS side_a,
--            assigned + unassigned + duplicates + failed + invalid AS side_b,
--            status
--       FROM lead_imports ORDER BY started_at DESC LIMIT 5;
--
--   What failed, and why:
--     SELECT row_number, outcome, reason, payload->>'full_name' AS name
--       FROM lead_import_rows r
--       JOIN lead_imports i ON i.id = r.import_id
--      WHERE i.reference = 'IMPORT-20260906-0001'
--        AND r.outcome IN ('failed', 'invalid');
--
--   Greetings still waiting to go out:
--     SELECT status, count(*) FROM lead_onboarding_queue GROUP BY 1;
-- ============================================================================

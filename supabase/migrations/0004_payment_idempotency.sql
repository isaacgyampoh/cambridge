-- ============================================================================
-- 0004 — PAYMENT IDEMPOTENCY, DEDUPE INFRASTRUCTURE, CATCH-ALL RLS
--
--   Purpose            Make payment webhook processing genuinely idempotent;
--                      guarantee the dedupe tables the code already depends on
--                      actually exist; close RLS on every remaining table.
--   Tables affected    payments (column + constraint), processed_events (new),
--                      message_jobs (new), every table in public (RLS only)
--   Functions created  record_payment_once, claim_event
--   Indexes created    5
--   RLS changes        Enabled on EVERY table in the public schema
--   Constraints        UNIQUE on payments.reference, processed_events.event_id,
--                      message_jobs.dedupe_key
--   Data migration     Backfills payments.reference from paystack_ref
--   Destructive        NO. Creates and adds only. No DROP, no DELETE.
--   Idempotent         YES. Safe to run more than once.
--
-- Run AFTER 0003_sms_queue.sql.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. THE DEDUPE TABLES THE CODE ALREADY USES
--
-- lib/messageJobs.ts and app/api/applications/complete/route.ts both depend on
-- message_jobs and processed_events, but NEITHER table is defined in any
-- schema file in this repository. They exist only in the live database, having
-- been created outside version control.
--
-- That matters more than it sounds, because of how the code reads a failure:
--
--     const { error } = await sb.from('message_jobs').insert({ ... })
--     return !error        // "false means someone else already claimed it"
--
-- A MISSING TABLE also produces an error, and is therefore indistinguishable
-- from "already claimed". If these tables are ever absent, every deduped
-- message silently stops sending and application completion always reports
-- alreadyProcessed without doing the work. Defining them here makes that
-- failure mode impossible.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS processed_events (
  event_id     TEXT PRIMARY KEY,
  source       TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key   TEXT NOT NULL,
  lead_id      UUID,
  phone        TEXT,
  kind         TEXT NOT NULL,
  body         TEXT,
  status       TEXT NOT NULL DEFAULT 'claimed',
  source_event TEXT,
  scheduled_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The unique index IS the deduplication. Without it the insert always succeeds
-- and claimJob() always reports a successful claim, so nothing is deduplicated.
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_jobs_dedupe ON message_jobs(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_message_jobs_lead ON message_jobs(lead_id);


-- ---------------------------------------------------------------------------
-- 2. PAYMENTS: A REFERENCE COLUMN WITH A UNIQUE CONSTRAINT
--
-- The webhook inserts `reference: ref`, but the payments table as defined in
-- FULL-SCHEMA.sql has no `reference` column at all — only `paystack_ref`. And
-- neither carried a unique constraint, so the duplicate check
--
--     SELECT id FROM payments WHERE reference = ref  →  if found, stop
--
-- could be passed by two concurrent webhook deliveries at once, both finding
-- nothing and both inserting. A unique index is what actually prevents that:
-- the second INSERT fails, and failing is the correct outcome.
-- ---------------------------------------------------------------------------

ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference TEXT;

-- Backfill so existing rows are covered by the constraint below.
UPDATE payments SET reference = paystack_ref
 WHERE reference IS NULL AND paystack_ref IS NOT NULL;

-- Partial unique index: NULL references (cash payments, manual entries) are
-- unconstrained; provider references are unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_reference
  ON payments(reference) WHERE reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_application ON payments(application_id);
CREATE INDEX IF NOT EXISTS idx_payments_student     ON payments(student_id);


-- ---------------------------------------------------------------------------
-- 3. CLAIM AN EXTERNAL EVENT, EXACTLY ONCE
--
-- Returns TRUE for the caller that wins the claim, FALSE for every later
-- delivery of the same event. The uniqueness of the primary key does the work,
-- so two simultaneous deliveries cannot both win.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claim_event(p_event_id TEXT, p_source TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO processed_events (event_id, source) VALUES (p_event_id, p_source);
  RETURN TRUE;
EXCEPTION
  WHEN unique_violation THEN
    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION claim_event(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_event(TEXT, TEXT) TO service_role;


-- ---------------------------------------------------------------------------
-- 4. RECORD A PAYMENT EXACTLY ONCE
--
-- Inserts the payment and reports whether this call created it. A repeat
-- delivery gets was_new = FALSE and the id of the payment that already exists,
-- so the caller can stay idempotent without a prior SELECT.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION record_payment_once(
  p_reference   TEXT,
  p_amount      NUMERIC,
  p_method      TEXT,
  p_purpose     TEXT DEFAULT NULL,
  p_application UUID DEFAULT NULL,
  p_student     UUID DEFAULT NULL,
  p_response    JSONB DEFAULT NULL
)
RETURNS TABLE(payment_id UUID, was_new BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO payments (
    reference, paystack_ref, amount, method, status, purpose,
    application_id, student_id, paystack_response, paid_at
  )
  VALUES (
    p_reference, p_reference, p_amount, p_method::payment_method, 'paid'::payment_status, p_purpose,
    p_application, p_student, p_response, NOW()
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, TRUE;

EXCEPTION
  WHEN unique_violation THEN
    -- Another delivery of the same payment got here first.
    SELECT id INTO v_id FROM payments WHERE reference = p_reference LIMIT 1;
    RETURN QUERY SELECT v_id, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION record_payment_once(TEXT, NUMERIC, TEXT, TEXT, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_payment_once(TEXT, NUMERIC, TEXT, TEXT, UUID, UUID, JSONB)
  TO service_role;


-- ---------------------------------------------------------------------------
-- 5. ATOMIC FEE INCREMENT
--
-- Balances were computed in application code as
--
--     newPaid = Number(fee.amount_paid) + amount
--
-- read first, written second. Two payments landing together both read the same
-- starting figure and the second overwrites the first — money silently lost
-- from the ledger. Doing the arithmetic inside the UPDATE makes it exact.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION apply_fee_payment(p_lead UUID, p_amount NUMERIC)
RETURNS TABLE(total_fee NUMERIC, amount_paid NUMERIC, balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE student_fees
     SET amount_paid = COALESCE(student_fees.amount_paid, 0) + p_amount,
         balance = GREATEST(0, COALESCE(student_fees.total_fee, 0)
                             - (COALESCE(student_fees.amount_paid, 0) + p_amount))
   WHERE lead_id = p_lead
  RETURNING student_fees.total_fee, student_fees.amount_paid, student_fees.balance;
END;
$$;

REVOKE ALL ON FUNCTION apply_fee_payment(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_fee_payment(UUID, NUMERIC) TO service_role;


-- ---------------------------------------------------------------------------
-- 6. CATCH-ALL ROW LEVEL SECURITY
--
-- Migration 0001 enabled RLS on an enumerated list. That list could only name
-- the tables defined in this repository's schema files — but 49 of the 79
-- tables the application queries are defined nowhere in version control. They
-- were therefore never covered.
--
-- Among them is student_sessions, which stores student portal session tokens
-- in plaintext. With no RLS and a public anon key, those tokens were readable
-- through the Data API by anyone, and each one grants ninety days of access to
-- that student's records.
--
-- Enumerating is the wrong approach for a schema this far out of sync with its
-- migrations. This enables RLS on EVERY table in the public schema that does
-- not already have it. Enabling with no policy is a default deny; the server
-- uses the service role, which bypasses RLS, so application behaviour does not
-- change. (Verified in code: the browser Supabase client is used only for
-- Storage, never for table reads.)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND c.relkind = 'r'          -- ordinary tables only, not views
       AND c.relrowsecurity = FALSE
  LOOP
    EXECUTE FORMAT('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Enabled row level security on % additional table(s).', n;
END $$;

COMMIT;

-- ============================================================================
-- VERIFY AFTER RUNNING
--
--   1. No table left without RLS — this must return zero rows:
--
--        SELECT c.relname FROM pg_class c
--          JOIN pg_namespace ns ON ns.oid = c.relnamespace
--         WHERE ns.nspname = 'public' AND c.relkind = 'r'
--           AND c.relrowsecurity = FALSE;
--
--   2. The payment reference constraint is in place:
--
--        SELECT indexname FROM pg_indexes
--         WHERE tablename = 'payments' AND indexname = 'idx_payments_reference';
--
--   3. Duplicate references, if any existed before the constraint, would have
--      blocked step 2. If the CREATE UNIQUE INDEX failed, find them with:
--
--        SELECT reference, COUNT(*) FROM payments
--         WHERE reference IS NOT NULL
--         GROUP BY reference HAVING COUNT(*) > 1;
--
--      Resolve those duplicates before re-running this migration.
-- ============================================================================

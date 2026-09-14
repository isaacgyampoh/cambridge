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

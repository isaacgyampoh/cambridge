-- ============================================================================
-- 0010 — RESOLVE CLASS MODE FROM THE APPLICATION THAT WAS ACTUALLY PAID FOR
--
-- Run AFTER 0009. Corrective and additive. No rows are deleted.
--
-- ── THE ACTUAL CAUSE OF THE WRONG ADMISSION LETTERS ────────────────────────
--
-- People register more than once. In this database, 3 of the 12 leads with an
-- application have two, and one of those two disagrees with the other about
-- the class mode:
--
--   Emmanuel
--     4 Aug   delivery = in_person   payment_status = pending   (abandoned)
--    10 Aug   delivery = online      payment_status = paid      (real one)
--
-- The pattern is ordinary and entirely reasonable from the applicant's side:
-- they start a registration for the physical class, do not pay, think again,
-- and register properly for the online class.
--
-- Any code that resolves "the application for this lead" without preferring
-- the PAID one can pick the abandoned row — and then generates a physical
-- admission letter for somebody enrolled online. That is the reported bug, and
-- it needs no template mix-up to explain it: the template selection was right,
-- the class mode handed to it was wrong.
--
-- ── THE RULE ───────────────────────────────────────────────────────────────
--
-- The authoritative application for a lead is, in order:
--   1. the paid one (money settles intent)
--   2. failing that, the most recently submitted one
--   3. failing that, the most recent one
--
-- next_class_mode_for_lead() below is that rule, so application code and SQL
-- cannot drift apart.
-- ============================================================================

BEGIN;

/*
 * The authoritative class mode for a lead. NULL when the lead has no
 * application, or when the application carries no usable mode — never a guess.
 */
CREATE OR REPLACE FUNCTION class_mode_for_lead(p_lead UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.delivery
    FROM applications a
   WHERE a.lead_id = p_lead
     AND a.delivery IN ('online', 'in_person')
   ORDER BY
     (a.payment_status = 'paid') DESC,   -- money settles it
     a.is_submitted DESC,                -- then a completed submission
     COALESCE(a.submitted_at, a.created_at) DESC,
     a.created_at DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION class_mode_for_lead(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION class_mode_for_lead(UUID) TO service_role;

/*
 * Correct the rows migration 0009 backfilled.
 *
 * 0009 copied delivery from `applications` with a plain join, which for a lead
 * with two applications picks whichever the planner returns first. For
 * Emmanuel that was the abandoned in_person row rather than the paid online
 * one. Re-derived here through the rule above.
 */
UPDATE admissions ad
   SET class_mode = class_mode_for_lead(ad.lead_id)
 WHERE ad.lead_id IS NOT NULL
   AND class_mode_for_lead(ad.lead_id) IS NOT NULL
   AND ad.class_mode IS DISTINCT FROM class_mode_for_lead(ad.lead_id);

COMMIT;

-- ============================================================================
-- AFTER RUNNING THIS
--
--   Every admission should now agree with the application that was paid for.
--   This must return no rows:
--
--     SELECT l.full_name, ad.class_mode, class_mode_for_lead(ad.lead_id)
--       FROM admissions ad JOIN leads l ON l.id = ad.lead_id
--      WHERE ad.class_mode IS DISTINCT FROM class_mode_for_lead(ad.lead_id)
--        AND class_mode_for_lead(ad.lead_id) IS NOT NULL;
--
--   Anyone who registered twice with DIFFERENT modes is worth a human glance,
--   because the abandoned row still sits in the pipeline looking real:
--
--     SELECT l.full_name, string_agg(DISTINCT a.delivery, ' vs ') AS modes
--       FROM applications a JOIN leads l ON l.id = a.lead_id
--      WHERE a.lead_id IS NOT NULL
--      GROUP BY l.full_name
--     HAVING count(DISTINCT a.delivery) > 1;
-- ============================================================================

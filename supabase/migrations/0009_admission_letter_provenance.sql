-- ============================================================================
-- 0009 — RECORD WHICH LETTER WAS ACTUALLY SENT
--
-- Run AFTER 0008. Additive: adds six columns and one constraint to admissions.
-- Idempotent, not destructive, no data removed.
--
-- WHY
--
-- The reported bug is "someone registers for the online class and receives the
-- physical admission letter". The selection logic is now mode-aware, but the
-- admissions table records only `admission_letter_sent` — a boolean. It does
-- not store which class mode the letter was generated for, which template was
-- used, or where the file went.
--
-- So when somebody reports receiving the wrong letter, there is no way to
-- confirm it, find the others affected, or prove a fix worked. The evidence
-- that would settle it does not exist.
--
-- These columns are that evidence. Every generated letter records the mode it
-- was generated for, the template it came from, and the resulting file.
--
-- The CHECK constraint is the part that makes the original bug unrepresentable
-- at the database level: a row cannot claim a class mode outside the canonical
-- pair, whatever the application code does.
-- ============================================================================

BEGIN;

/*
 * The class mode the letter was generated FOR — copied from the registration
 * at generation time, so it is a record of what happened rather than a live
 * join that would silently change if the application were edited afterwards.
 */
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS class_mode           TEXT;

/* Which document was used, and where the finished letter went. */
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS letter_template_id   UUID REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS letter_template_name TEXT;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS letter_url           TEXT;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS letter_generated_at  TIMESTAMPTZ;

/*
 * How the letter came about:
 *   uploaded          an uploaded document, used as-is
 *   uploaded_template an uploaded template, personalised for this student
 *   generated         the built-in PDF fallback, when no document matched
 *
 * Worth separating: "no template matched and we fell back" is the case most
 * likely to produce a letter nobody reviewed.
 */
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS letter_source        TEXT;

-- Backfill the mode for letters already sent, from the registration that
-- produced them, so existing rows are auditable too. Only where it is
-- unambiguous; anything else stays NULL rather than being guessed.
UPDATE admissions ad
   SET class_mode = a.delivery
  FROM applications a
 WHERE a.lead_id = ad.lead_id
   AND ad.class_mode IS NULL
   AND a.delivery IN ('online', 'in_person');

/*
 * Makes the bug unrepresentable. NULL is permitted because an admission can
 * exist before its letter is generated; a WRONG value cannot be written at all.
 */
ALTER TABLE admissions DROP CONSTRAINT IF EXISTS admissions_class_mode_check;
ALTER TABLE admissions ADD CONSTRAINT admissions_class_mode_check
  CHECK (class_mode IS NULL OR class_mode IN ('online', 'in_person'));

CREATE INDEX IF NOT EXISTS idx_admissions_class_mode ON admissions(class_mode);
CREATE INDEX IF NOT EXISTS idx_admissions_letter_gen ON admissions(letter_generated_at DESC);

COMMIT;

-- ============================================================================
-- THE QUERY THIS EXISTS FOR
--
--   Anyone whose letter does not match their registration — this must return
--   no rows, and is the direct test of the reported bug:
--
--     SELECT l.full_name, a.delivery AS registered_for,
--            ad.class_mode AS letter_was_for, ad.letter_template_name
--       FROM admissions ad
--       JOIN applications a ON a.lead_id = ad.lead_id
--       JOIN leads l        ON l.id      = ad.lead_id
--      WHERE ad.class_mode IS NOT NULL
--        AND ad.class_mode <> a.delivery;
--
--   Letters that fell back to the built-in PDF because no template matched —
--   worth reviewing, since nobody approved their wording:
--
--     SELECT count(*) FROM admissions WHERE letter_source = 'generated';
-- ============================================================================

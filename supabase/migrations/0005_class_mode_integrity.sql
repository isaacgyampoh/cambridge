-- ============================================================================
-- 0005 — CLASS MODE INTEGRITY AND ADMISSION NUMBER SEQUENCE
--
--   Purpose            Make it impossible for the database to hold a class
--                      mode outside the canonical vocabulary; stop admission
--                      numbers colliding.
--   Tables affected    applications, student_fees, marketer_enrollments,
--                      admissions (index only)
--   Functions created  next_admission_number
--   Sequences created  admission_number_seq
--   Indexes created    3
--   RLS changes        none (0004 covered every table)
--   Constraints        CHECK on applications.delivery, student_fees.delivery,
--                      marketer_enrollments.delivery; UNIQUE on
--                      admissions.admission_number
--   Data migration     YES — normalises existing delivery values in place
--   Destructive        NO. Updates values to their canonical spelling; no row
--                      is deleted and no column is dropped.
--   Idempotent         YES.
--
-- Run AFTER 0004_payment_idempotency.sql.
--
-- BEFORE RUNNING, see what will change:
--   SELECT delivery, COUNT(*) FROM applications GROUP BY delivery;
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. NORMALISE EXISTING VALUES
--
-- One concept was spelled three ways across the system:
--     applications.delivery   'online' | 'in_person'
--     batches.class_type      'online' | 'physical'   (a real pg enum)
--     and various synonyms written by forms and imports
--
-- The canonical pair is 'online' | 'in_person', matching applications.delivery
-- because that is the column the admission and document logic reads.
-- batches.class_type keeps its enum spelling and is translated in code by
-- lib/classMode.ts rather than being compared inline.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['applications', 'student_fees', 'marketer_enrollments'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = 'delivery'
    ) THEN
      EXECUTE FORMAT($f$
        UPDATE public.%I SET delivery =
          CASE LOWER(TRIM(REPLACE(delivery, '-', '_')))
            WHEN 'online'         THEN 'online'
            WHEN 'virtual'        THEN 'online'
            WHEN 'virtual_class'  THEN 'online'
            WHEN 'remote'         THEN 'online'
            WHEN 'zoom'           THEN 'online'
            WHEN 'in_person'      THEN 'in_person'
            WHEN 'in person'      THEN 'in_person'
            WHEN 'inperson'       THEN 'in_person'
            WHEN 'physical'       THEN 'in_person'
            WHEN 'physical_class' THEN 'in_person'
            WHEN 'onsite'         THEN 'in_person'
            WHEN 'on_site'        THEN 'in_person'
            WHEN 'campus'         THEN 'in_person'
            WHEN 'classroom'      THEN 'in_person'
            ELSE delivery
          END
        WHERE delivery IS NOT NULL
      $f$, t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. THE CONSTRAINT
--
-- With this in place no code path — not a route, not an import, not a manual
-- SQL edit — can store a class mode outside the canonical pair. NULL stays
-- permitted so that historical rows with no recorded mode are not destroyed;
-- the application treats NULL as a validation failure and refuses to generate
-- documents from it rather than guessing, which is what caused the original
-- virtual/physical mix-up.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  bad INT;
BEGIN
  FOREACH t IN ARRAY ARRAY['applications', 'student_fees', 'marketer_enrollments'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = 'delivery'
    ) THEN
      -- Refuse to add a constraint that existing data would violate; report
      -- instead, so nothing is silently discarded.
      EXECUTE FORMAT(
        'SELECT COUNT(*) FROM public.%I WHERE delivery IS NOT NULL AND delivery NOT IN (''online'', ''in_person'')', t
      ) INTO bad;

      IF bad > 0 THEN
        RAISE WARNING
          'Table % still holds % row(s) with an unrecognised delivery value. Constraint NOT added. Inspect with: SELECT DISTINCT delivery FROM %I;',
          t, bad, t;
      ELSE
        EXECUTE FORMAT('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_delivery_check');
        EXECUTE FORMAT(
          'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (delivery IS NULL OR delivery IN (''online'', ''in_person''))',
          t, t || '_delivery_check'
        );
      END IF;
    END IF;
  END LOOP;
END $$;


-- ---------------------------------------------------------------------------
-- 3. ADMISSION NUMBERS
--
-- These were generated as:
--     `CCE/${year}/${Math.floor(1000 + Math.random() * 9000)}`
--
-- a four-digit random with no unique constraint behind it. By the birthday
-- bound that collides at roughly eighty students in a year — and two students
-- sharing an admission number is not a cosmetic problem.
--
-- A sequence cannot collide, and the unique index makes it provable.
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS admission_number_seq START WITH 1000;

CREATE OR REPLACE FUNCTION next_admission_number()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'CCE/' || EXTRACT(YEAR FROM NOW())::INT || '/' || LPAD(nextval('admission_number_seq')::TEXT, 5, '0');
$$;

REVOKE ALL ON FUNCTION next_admission_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION next_admission_number() TO service_role;

-- Only add the unique index if existing numbers are already distinct.
DO $$
DECLARE dupes INT;
BEGIN
  SELECT COUNT(*) INTO dupes FROM (
    SELECT admission_number FROM admissions
     WHERE admission_number IS NOT NULL
     GROUP BY admission_number HAVING COUNT(*) > 1
  ) d;

  IF dupes > 0 THEN
    RAISE WARNING
      'admissions holds % duplicated admission_number value(s) — a consequence of the random generator. Unique index NOT added. List them with: SELECT admission_number, COUNT(*) FROM admissions GROUP BY admission_number HAVING COUNT(*) > 1;',
      dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admissions_number
      ON admissions(admission_number) WHERE admission_number IS NOT NULL;
  END IF;
END $$;

-- Advance the sequence past any number already issued, so it cannot reissue one.
DO $$
DECLARE hi BIGINT;
BEGIN
  SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(admission_number, '^.*/', ''), '')::BIGINT), 999)
    INTO hi
    FROM admissions
   WHERE admission_number ~ '^CCE/[0-9]{4}/[0-9]+$';
  PERFORM setval('admission_number_seq', GREATEST(hi, 999) + 1, FALSE);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not advance admission_number_seq automatically; starting at its default.';
END $$;


-- ---------------------------------------------------------------------------
-- 4. INDEXES FOR THE DOCUMENT RESOLVER AND CLASS-MODE QUERIES
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_documents_type_course
  ON documents(type, course_id);

CREATE INDEX IF NOT EXISTS idx_batches_course_type
  ON batches(course_id, class_type, start_date);

CREATE INDEX IF NOT EXISTS idx_applications_delivery
  ON applications(delivery);

COMMIT;

-- ============================================================================
-- VERIFY AFTER RUNNING
--
--   1. Only canonical values remain — should return exactly 'online' and/or
--      'in_person' (and possibly NULL):
--
--        SELECT DISTINCT delivery FROM applications;
--
--   2. The constraint is present:
--
--        SELECT conname FROM pg_constraint
--         WHERE conname = 'applications_delivery_check';
--
--      If it is ABSENT, the migration raised a warning because unrecognised
--      values remain. Inspect and correct them, then re-run this migration.
--
--   3. Admission numbers are unique:
--
--        SELECT admission_number, COUNT(*) FROM admissions
--         WHERE admission_number IS NOT NULL
--         GROUP BY admission_number HAVING COUNT(*) > 1;
-- ============================================================================

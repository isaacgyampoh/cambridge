-- ============================================================================
-- 0008 — MAKE ALREADY-SUBMITTED REGISTRATIONS VISIBLE
--
-- Run AFTER 0007. Additive: creates leads and links them. Nothing is deleted.
-- Idempotent: only touches applications that still have lead_id IS NULL.
--
-- WHY
--
-- Applications were only linked to a lead in /api/applications/complete, which
-- runs after Paystack confirms payment. Anyone who filled in the registration
-- link but had not yet paid was stored as an applications row with
-- lead_id = NULL — and every portal view reads from leads, so staff never saw
-- them. This is the reported symptom "someone clicks the registration link and
-- it never reflects on the portal".
--
-- In this database that was 9 of 15 applications (13 submitted, 6 paid).
--
-- The code fix (lib/registration/linkLead.ts) links at submission time from
-- now on. This migration rescues the ones already stranded.
--
-- Matching is by phone first, then email, so a person who enquired earlier is
-- reunited with their existing lead rather than duplicated. Anything with
-- neither is reported and left alone — inventing a contactless lead helps
-- nobody.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  r            RECORD;
  v_lead       UUID;
  v_phone      TEXT;
  v_email      TEXT;
  v_linked     INT := 0;
  v_created    INT := 0;
  v_skipped    INT := 0;
BEGIN
  FOR r IN
    SELECT id, full_name, email, phone, utm_source, landing_source
      FROM applications
     WHERE lead_id IS NULL
  LOOP
    -- Canonical Ghanaian form: 233XXXXXXXXX.
    v_phone := NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(r.phone,''), '[^0-9]', '', 'g'), '^(233|0)', ''), '');
    IF v_phone IS NOT NULL THEN v_phone := '233' || v_phone; END IF;
    v_email := NULLIF(LOWER(TRIM(COALESCE(r.email, ''))), '');

    IF v_phone IS NULL AND v_email IS NULL THEN
      v_skipped := v_skipped + 1;
      RAISE NOTICE 'Application % has neither phone nor email — left unlinked.', r.id;
      CONTINUE;
    END IF;

    v_lead := NULL;

    -- Existing lead by phone, in any of the stored spellings.
    IF v_phone IS NOT NULL THEN
      SELECT l.id INTO v_lead FROM leads l
       WHERE REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(l.phone,''), '[^0-9]', '', 'g'), '^(233|0)', '')
             = REGEXP_REPLACE(v_phone, '^233', '')
         AND COALESCE(l.phone,'') <> ''
       ORDER BY l.created_at DESC LIMIT 1;
    END IF;

    -- Then by email.
    IF v_lead IS NULL AND v_email IS NOT NULL THEN
      SELECT l.id INTO v_lead FROM leads l
       WHERE LOWER(l.email) = v_email
       ORDER BY l.created_at DESC LIMIT 1;
    END IF;

    IF v_lead IS NULL THEN
      INSERT INTO leads (full_name, phone, email, source, status, landing_source)
      VALUES (
        COALESCE(NULLIF(TRIM(r.full_name), ''), 'Registration'),
        v_phone, v_email,
        -- leads.source is the lead_source enum, not text: only a UTM value
        -- that is genuinely one of its labels may be used.
        (CASE WHEN LOWER(COALESCE(r.utm_source,'')) IN
                ('facebook','google','linkedin','website','referral','manual','walk_in')
              THEN LOWER(r.utm_source) ELSE 'website' END)::lead_source,
        'ready_to_join',
        COALESCE(r.landing_source, 'Registration link (backfilled)')
      )
      RETURNING id INTO v_lead;
      v_created := v_created + 1;
    ELSE
      -- Move a live lead forward, never drag a settled one backwards.
      UPDATE leads SET status = 'ready_to_join'
       WHERE id = v_lead
         AND status NOT IN ('registered', 'done', 'not_interested', 'lost');
      v_linked := v_linked + 1;
    END IF;

    UPDATE applications SET lead_id = v_lead WHERE id = r.id;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % linked to existing leads, % new leads created, % skipped (no contact details).',
    v_linked, v_created, v_skipped;
END $$;

COMMIT;

-- ============================================================================
-- AFTER RUNNING THIS
--
--   Expect zero, apart from any application with no phone AND no email:
--     SELECT count(*) FROM applications WHERE lead_id IS NULL;
--
--   The rescued registrations, now visible to staff:
--     SELECT l.full_name, l.status, l.assigned_to, a.payment_status
--       FROM applications a JOIN leads l ON l.id = a.lead_id
--      WHERE l.landing_source LIKE '%backfilled%';
--
--   They are deliberately left UNASSIGNED so a project manager can distribute
--   them deliberately — from Leads → Assign unassigned — rather than having
--   nine of them land silently on whoever the algorithm picked at 3am.
-- ============================================================================

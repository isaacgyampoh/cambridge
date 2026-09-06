-- ============================================================================
-- 0014 — ONE AUTHORITATIVE FOLLOW-UP DATE
--
-- Run AFTER 0013. Relaxes one NOT NULL, adds one trigger, backfills. Nothing
-- is dropped and no follow-up is lost.
--
-- ── THE SPLIT BRAIN ────────────────────────────────────────────────────────
--
-- A follow-up date could live in three places, and which one it landed in
-- depended on which screen you used:
--
--   leads.follow_up_at              written by: the leads list, the WhatsApp
--                                   webhook
--                                   read by: the leads list (overdue banner
--                                   and filter), the lead detail header, the
--                                   dashboard "follow-ups overdue/due" counts
--
--   follow_up_queue                 written by: the lead detail page
--                                   read by: /marketer/activities, which IS
--                                   the Follow-ups screen
--
--   lead_activities.next_follow_up  written by: the lead detail page
--                                   read by: the activity timeline only
--
-- So a follow-up set on the lead detail page never appeared in the overdue
-- banner or on the dashboard, and one set from the leads list never appeared
-- on the Follow-ups screen. Neither view ever showed the whole picture, and
-- each looked authoritative to whoever was using it.
--
-- ── THE RULE NOW ───────────────────────────────────────────────────────────
--
--   follow_up_queue    is the record of follow-up WORK. It has the lifecycle
--                      — pending, snoozed, done, done_at, priority, reason —
--                      that a single date column cannot express. Every write
--                      goes here.
--
--   leads.follow_up_at is DERIVED: the earliest pending follow-up for that
--                      lead, or NULL. Maintained by the trigger below and
--                      written by no application code. It exists so the leads
--                      list and the dashboard can filter and count without an
--                      aggregate join per row.
--
--   lead_activities.next_follow_up stays as it is: a historical note of what
--                      was intended at the time an activity was logged. It is
--                      a log entry, not a schedule, and nothing reads it as
--                      one.
--
-- Because the mirror is maintained by a trigger rather than by convention, the
-- two cannot drift no matter which code path writes.
-- ============================================================================

BEGIN;

/*
 * A follow-up can exist before anyone owns the lead.
 *
 * marketer_id was NOT NULL, so an unassigned lead could not have a queue row
 * at all — which is why the WhatsApp webhook wrote the leads column directly
 * instead. Relaxing it lets every write use one path. The Follow-ups screen
 * filters by marketer_id, so an unowned follow-up simply appears for nobody,
 * which is correct: there is no one to do it yet.
 */
ALTER TABLE follow_up_queue ALTER COLUMN marketer_id DROP NOT NULL;

/*
 * Keep leads.follow_up_at equal to the earliest PENDING follow-up.
 *
 * Runs for the lead on both sides of the change, so moving a queue row from
 * one lead to another refreshes both. A row that is completed or snoozed out
 * of 'pending' stops counting immediately, which is what makes the dashboard
 * figure trustworthy.
 */
CREATE OR REPLACE FUNCTION sync_lead_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead UUID;
BEGIN
  FOREACH v_lead IN ARRAY (
    SELECT ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.lead_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.lead_id END
    ]) AS x WHERE x IS NOT NULL)
  )
  LOOP
    UPDATE leads
       SET follow_up_at = (
             SELECT MIN(q.follow_up_at)
               FROM follow_up_queue q
              WHERE q.lead_id = v_lead
                AND COALESCE(q.status, 'pending') = 'pending'
           )
     WHERE leads.id = v_lead;
  END LOOP;

  RETURN NULL;   -- AFTER trigger; the return value is not used
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_lead_follow_up ON follow_up_queue;
CREATE TRIGGER trg_sync_lead_follow_up
AFTER INSERT OR UPDATE OR DELETE ON follow_up_queue
FOR EACH ROW EXECUTE FUNCTION sync_lead_follow_up();

/*
 * Nothing already scheduled may be lost.
 *
 * A lead carrying follow_up_at with no pending queue row had its date written
 * by one of the paths that bypassed the queue. Each becomes a real queue row,
 * owned by whoever the lead is assigned to — or by nobody, which the relaxed
 * column now permits.
 */
INSERT INTO follow_up_queue (lead_id, marketer_id, follow_up_at, reason, priority, status)
SELECT l.id, l.assigned_to, l.follow_up_at,
       'Carried over when follow-ups were consolidated', 'normal', 'pending'
  FROM leads l
 WHERE l.follow_up_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM follow_up_queue q
      WHERE q.lead_id = l.id AND COALESCE(q.status, 'pending') = 'pending'
   );

-- Now recompute the mirror for every lead, so the column and the queue agree
-- from this moment on.
UPDATE leads l
   SET follow_up_at = (
         SELECT MIN(q.follow_up_at)
           FROM follow_up_queue q
          WHERE q.lead_id = l.id
            AND COALESCE(q.status, 'pending') = 'pending'
       )
 WHERE l.follow_up_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM follow_up_queue q WHERE q.lead_id = l.id);

-- The leads list and the dashboard both filter on this column.
CREATE INDEX IF NOT EXISTS idx_leads_follow_up_at
  ON leads(follow_up_at)
  WHERE follow_up_at IS NOT NULL;

COMMIT;

-- ============================================================================
-- CHECKING IT
--
--   Any lead whose mirror disagrees with the queue (must return no rows):
--
--     SELECT l.id, l.follow_up_at, q.earliest
--       FROM leads l
--       LEFT JOIN (
--         SELECT lead_id, MIN(follow_up_at) AS earliest
--           FROM follow_up_queue
--          WHERE COALESCE(status,'pending') = 'pending'
--          GROUP BY lead_id
--       ) q ON q.lead_id = l.id
--      WHERE l.follow_up_at IS DISTINCT FROM q.earliest;
-- ============================================================================

-- Fifty-seven tables were readable AND writable by anyone with the public key.
--
-- 0023 enabled Row Level Security on the tables that lacked it, and the count
-- of tables without RLS went to zero. The data stayed open anyway, because
-- enabling RLS only matters when no policy grants access — and these carried
-- a policy named <table>_all:
--
--     roles = {public}     cmd = ALL     qual = true
--
-- Anyone, any operation, unconditionally. Not merely readable: insertable,
-- updatable and deletable with a key that is compiled into the browser bundle
-- and published in a public repository. student_fees, fee_payments,
-- class_payments, certificates, prep_records, settings and fifty-one others.
--
-- scripts/verify-rls.mjs reported nine, because nine is what its hand-written
-- table list covered. The probe was only ever as good as that list, and the
-- list was wrong.
--
-- ── WHY DROPPING THEM IS SAFE ──────────────────────────────────────────────
--
-- Nothing in the browser queries a table. Every server route builds its client
-- with the service role, which bypasses RLS entirely; the only use of the anon
-- key from a browser is an upload to the alumni-photos STORAGE bucket, which
-- has its own policies and is untouched here.
--
-- 0001 already did this for five such policies and recorded the same
-- reasoning: public application and testimonial submission keep working,
-- because they go through server routes and never needed an anon policy.
--
-- Policies that genuinely scope a row are NOT dropped: the condition below
-- requires both USING and WITH CHECK to be absent or literally true, so
-- anything like notifications_own (user_id = auth.uid()) survives.

DO $$
DECLARE
  p RECORD;
  dropped INT := 0;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles::text LIKE '%public%'
      AND (qual IS NULL OR qual::text = 'true')
      AND (with_check IS NULL OR with_check::text = 'true')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    dropped := dropped + 1;
  END LOOP;
  RAISE NOTICE 'dropped % wide-open policies', dropped;
END $$;

-- Every table keeps RLS on. With no policy left that grants the anonymous
-- role anything, PostgREST returns nothing to the public key — which is the
-- state 0023 was meant to produce and did not.

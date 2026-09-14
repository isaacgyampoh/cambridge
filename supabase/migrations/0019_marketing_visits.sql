-- ============================================================================
-- 0019 — WHO OPENED A STAFF MARKETING LINK, WITHOUT KNOWING WHO THEY ARE
--
-- Run AFTER 0018. Additive: one table, three indexes. Nothing else changes.
--
-- WHY
--
-- /m/{code} is the permanent link a member of staff puts on a flyer, a QR
-- code or an Instagram bio. Leads and registrations that come from it are
-- already attributed — the existing application flow does that. What nothing
-- records is the step before: somebody opened it and did not register.
--
-- Without that, a marketer cannot tell a link nobody clicks from a link many
-- people click and leave. Those need opposite responses — share it somewhere
-- else, or fix what the page says — and the two are indistinguishable when
-- the only number is registrations.
--
-- WHAT IS DELIBERATELY NOT STORED
--
-- No IP address, no user agent, no cookie that survives the visit, and
-- nothing that could later be joined to a person. A click is not consent and
-- an open link is not an identity: somebody who reads a flyer and closes it
-- has told the centre nothing about themselves, and this table must not
-- pretend otherwise.
--
-- session_id is a random value the browser makes up for one visit. It exists
-- so that opening the same link twice in a minute is not counted as two
-- people — not so anybody can be followed. It is meaningless outside this
-- table and is never joined to leads.
--
-- Personal details arrive only through the registration form, on the existing
-- path, where the person has typed them in on purpose.
--
-- RETENTION
--
-- Ninety days. Long enough to compare this month with last; short enough that
-- a table of anonymous browsing does not accumulate for ever. 0007_retention
-- established the pattern and prune_old_logs is where this is swept.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS marketing_visits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The link that was opened. Deliberately the CODE and not a profile id:
  -- the code is already public (it is in the URL), and storing the id would
  -- put an internal identifier in a table written by an anonymous request.
  marketer_code TEXT NOT NULL,

  -- Random, per visit, from the browser. Not a person.
  session_id  TEXT NOT NULL,

  -- What they were shown, so a marketer can see which promotion drew people.
  -- Null when nothing was scheduled and the page listed programmes instead.
  course_id   UUID REFERENCES courses(id) ON DELETE SET NULL,

  -- Where they came from, host only, for "Instagram or WhatsApp?". Never the
  -- full URL: a referring address can itself carry personal information.
  referrer_host TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per session per link per day. The beacon fires on every page view,
-- so without this a person refreshing twice is two visits.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_visits_once
  ON marketing_visits (marketer_code, session_id, (created_at::date));

-- "How is MY link doing" — the marketer's own panel.
CREATE INDEX IF NOT EXISTS idx_marketing_visits_code
  ON marketing_visits (marketer_code, created_at DESC);

-- The admin comparison across staff.
CREATE INDEX IF NOT EXISTS idx_marketing_visits_created
  ON marketing_visits (created_at DESC);

-- Written by the service role only, through /api/marketing/visit. No browser
-- reaches this table directly, and nothing reads it without a session.
ALTER TABLE marketing_visits ENABLE ROW LEVEL SECURITY;

COMMIT;

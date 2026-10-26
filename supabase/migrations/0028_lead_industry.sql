/*
 * What industry a lead is in.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 *
 * The centre sells professional certifications, and which one suits somebody
 * is largely a question of what they do: PMP sells into construction, oil and
 * gas and the public sector; the HR qualifications sell into banking,
 * telecoms and large manufacturers. A purchased list of five hundred names is
 * worth far more when the mix is known — it is the difference between a
 * targeted follow-up and five hundred identical calls.
 *
 * Captured at upload, where the operator already knows what the list is.
 *
 * ── A CODE, NOT A TYPED ANSWER ─────────────────────────────────────────────
 *
 * TEXT, holding one of the sixteen codes in lib/leads/industry.ts, written
 * only after being parsed through that module. Deliberately not a Postgres enum: the
 * list will gain entries, and an enum makes every addition a migration and a
 * deploy — while lead_source being an enum is exactly why a row that said
 * "walk_in" once failed its insert with no explanation anybody could act on.
 *
 * NULL means nobody has said. It is not the same as 'other', which is
 * somebody saying none of these fit.
 */

ALTER TABLE leads ADD COLUMN IF NOT EXISTS industry TEXT;

COMMENT ON COLUMN leads.industry IS
  'One of the sixteen industry codes in lib/leads/industry.ts. NULL means not stated: there is deliberately no ''other''.';

/*
 * The index is for the question this column exists to answer: "how many of
 * this list are in banking?". Partial, because the rows with no industry are
 * never the ones being counted, and on a table where most rows predate this
 * column that is most of them.
 */
CREATE INDEX IF NOT EXISTS idx_leads_industry
  ON leads (industry)
  WHERE industry IS NOT NULL;

/*
 * Nothing is backfilled. A guess at the industry of a lead imported last
 * month is indistinguishable, afterwards, from something somebody was told —
 * and the whole value of the column is that it can be trusted.
 */

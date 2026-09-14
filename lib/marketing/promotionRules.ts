import type { Programme, Cohort } from '../chatbot/programmeRules.ts'

/**
 * WHAT THE CENTRE IS PROMOTING RIGHT NOW.
 *
 * ── WHY THERE IS NO `promotions` TABLE ─────────────────────────────────────
 *
 * A permanent staff link has to show whatever is current without the staff
 * member doing anything. The obvious way to build that is a marketing table
 * an administrator edits — and it would immediately be a second copy of
 * facts that already exist: the programme name, the fee, the start date, the
 * delivery mode.
 *
 * Two copies of a fee is the failure this codebase has spent the longest
 * fixing. A marketing table would put a price on a public page that nobody
 * updates when the real one changes, under a marketer's name.
 *
 * The ERP already knows the answer. A cohort — a row in `batches` — has a
 * course, a start date, a delivery mode and a status. The thing the centre is
 * promoting is simply THE NEXT COHORT THAT STARTS. Scheduling one is how an
 * administrator already announces a programme, so:
 *
 *     admin schedules a PMP in-person cohort   -> /m/ada shows PMP, in person
 *     admin schedules a PMP online cohort next -> /m/ada shows PMP, online
 *     admin schedules a new programme          -> /m/ada shows that
 *
 * — with no marketing screen to remember, no second fee to keep in step, and
 * the same permanent URL throughout.
 *
 * Pure and dependency-free so the choice can be exercised directly; the
 * reading of it lives in ./promotion.ts.
 */

export type Promotion = {
  programme: Programme
  /** The cohort that makes this the current one. */
  cohort: Cohort
  /** The fee that actually applies to that cohort. Null if none is recorded. */
  fee: number | null
  /** What to call the delivery mode to a member of the public. */
  modeLabel: string
}

/** A cohort worth promoting: it has a date, and that date has not passed. */
function promotable(c: Cohort, today: number): boolean {
  if (!c.startDate) return false
  const t = new Date(c.startDate).getTime()
  if (Number.isNaN(t)) return false
  return t >= today
}

/**
 * The fee for one cohort of one programme.
 *
 * A cohort is online or it is not, and the two have different prices. Falling
 * back to the other one matters: a centre that has only recorded a single fee
 * should show that fee rather than nothing, and showing nothing is what would
 * happen if this returned only the exact match.
 */
export function feeFor(programme: Programme, cohort: Cohort): number | null {
  const exact = cohort.online ? programme.feeOnline : programme.feeInPerson
  if (exact !== null && exact !== undefined) return exact
  const other = cohort.online ? programme.feeInPerson : programme.feeOnline
  return other ?? null
}

export function modeLabelFor(cohort: Cohort): string {
  return cohort.online ? 'Online' : 'In person'
}

/**
 * The single programme to put in front of somebody arriving on a staff link.
 *
 * The soonest cohort wins. Ties are broken by the order the programmes came
 * back in, which is by name — arbitrary but stable, so the page does not
 * change on refresh.
 *
 * Returns null when nothing is scheduled. The caller shows the centre's
 * programmes generally rather than inventing a promotion, because a page that
 * announces a start date nobody has set is worse than one that does not.
 */
export function pickPromotion(
  programmes: Programme[],
  now: Date = new Date(),
): Promotion | null {
  // Midnight today, so a cohort starting later today still counts as upcoming.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

  let best: { programme: Programme; cohort: Cohort; at: number } | null = null

  for (const programme of programmes || []) {
    for (const cohort of programme.cohorts || []) {
      if (!promotable(cohort, today)) continue
      const at = new Date(cohort.startDate as string).getTime()
      if (!best || at < best.at) best = { programme, cohort, at }
    }
  }

  if (!best) return null

  return {
    programme: best.programme,
    cohort: best.cohort,
    fee: feeFor(best.programme, best.cohort),
    modeLabel: modeLabelFor(best.cohort),
  }
}

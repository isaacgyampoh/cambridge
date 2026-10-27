/*
 * Import-free apart from the industry list, which is itself import-free, so
 * these counts are exercised directly in a test rather than read off a screen.
 */
import { INDUSTRIES, industryLabel } from './industry.ts'

/**
 * A STAFF MEMBER'S LEADS, GROUPED BY WHAT THOSE PEOPLE DO.
 *
 * ── WHY GROUPING AND NOT JUST A FILTER ─────────────────────────────────────
 *
 * A marketer with thirty leads has one list of thirty names, and the thing
 * they actually want to do is ring the eight people in construction about the
 * same programme, one after another. Sorting that out by eye, every morning,
 * is the work the system was leaving to them.
 *
 * ── THE RULE THAT KEEPS THE TOTALS HONEST ──────────────────────────────────
 *
 * Every lead lands in exactly one group. A lead with no industry is not
 * dropped and not duplicated into a catch-all as well as its own group — it
 * goes to "Not stated", and the groups therefore add up to the total. Quota
 * figures are computed from the same list, so a breakdown can never disagree
 * with the number it breaks down.
 */

export type StatusCounted = { status?: string | null; industry?: string | null; course_interest?: string | null }

/**
 * The status that means somebody converted, and the statuses that mean the
 * conversation is over. Both are lib/analytics/leadStats.ts's definitions,
 * restated here only because that module carries types this one does not
 * need — if they ever disagree, THAT file is right.
 */
export const CONVERTED_STATUS = 'registered'
export const CLOSED_STATUSES: readonly string[] = ['registered', 'lost', 'not_interested', 'done']

/** The group a lead with no industry on file belongs to. */
export const UNSTATED = '__unstated__'
export const UNSTATED_LABEL = 'Not stated'

export type IndustryGroup = {
  code: string
  label: string
  total: number
  converted: number
  /** Still open: not registered, lost, not interested or done. */
  pending: number
  /** Courses wanted inside this industry, biggest first. */
  courses: Array<{ course: string; count: number }>
}

export type IndustryBreakdown = {
  groups: IndustryGroup[]
  total: number
  /** Leads whose industry nobody has stated. Also present as a group. */
  unstated: number
}

const UNKNOWN_COURSE = 'Not stated'

/**
 * Group leads by industry, with the counts the dashboards show.
 *
 * Ordered by size, largest first, because the group somebody works through
 * first is the one with the most people in it. "Not stated" is always last
 * however big it is: it is a gap to be filled, not a sector to work.
 */
export function groupByIndustry(leads: readonly StatusCounted[]): IndustryBreakdown {
  const buckets = new Map<string, { total: number; converted: number; pending: number; courses: Map<string, number> }>()

  for (const lead of leads) {
    const raw = typeof lead.industry === 'string' ? lead.industry.trim() : ''
    const known = INDUSTRIES.some(i => i.code === raw)
    const code = known ? raw : UNSTATED

    let bucket = buckets.get(code)
    if (!bucket) {
      bucket = { total: 0, converted: 0, pending: 0, courses: new Map() }
      buckets.set(code, bucket)
    }

    bucket.total++
    const status = String(lead.status || '')
    if (status === CONVERTED_STATUS) bucket.converted++
    if (!CLOSED_STATUSES.includes(status)) bucket.pending++

    const course = String(lead.course_interest || '').trim() || UNKNOWN_COURSE
    bucket.courses.set(course, (bucket.courses.get(course) || 0) + 1)
  }

  const groups: IndustryGroup[] = [...buckets.entries()].map(([code, b]) => ({
    code,
    label: code === UNSTATED ? UNSTATED_LABEL : industryLabel(code),
    total: b.total,
    converted: b.converted,
    pending: b.pending,
    courses: [...b.courses.entries()]
      .map(([course, count]) => ({ course, count }))
      .sort((a, b2) => b2.count - a.count || a.course.localeCompare(b2.course)),
  }))

  groups.sort((a, b) => {
    if (a.code === UNSTATED) return 1
    if (b.code === UNSTATED) return -1
    return b.total - a.total || a.label.localeCompare(b.label)
  })

  return {
    groups,
    total: leads.length,
    unstated: buckets.get(UNSTATED)?.total || 0,
  }
}

/**
 * Do the groups account for every lead exactly once?
 *
 * The invariant a breakdown has to hold: shown beside a quota figure computed
 * from the same leads, a breakdown that double-counts makes the quota look
 * wrong — and the quota is the number somebody is measured against.
 */
export function breakdownBalances(breakdown: IndustryBreakdown): boolean {
  const summed = breakdown.groups.reduce((n, g) => n + g.total, 0)
  const codes = breakdown.groups.map(g => g.code)
  return summed === breakdown.total && new Set(codes).size === codes.length
}

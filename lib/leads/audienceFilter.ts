/*
 * Import-free, so every rule here is unit tested directly.
 */

/**
 * WHO AN INFO SESSION GOES TO.
 *
 * ── WHAT THIS REPLACED ─────────────────────────────────────────────────────
 *
 * Three presets: all active leads, uncontacted, or interested. Anything else
 * — "the people who came in last month who want PMP", "everyone from the
 * September import who said they were interested" — could not be asked for,
 * so the invitation went to everybody and the targeting happened in the
 * recipient's head.
 *
 * ── THE SHAPE OF A SELECTION ───────────────────────────────────────────────
 *
 * A set of conditions, each a list. Within one condition the values are
 * alternatives (status is interested OR follow_up); between conditions they
 * narrow each other (that status AND added last month). That is the way
 * people read a filter, and it is the only combination rule here — anything
 * cleverer would need explaining, and a filter nobody can predict is a filter
 * nobody trusts with eight hundred text messages.
 *
 * ── AND WHY IT IS STORED WITH THE CAMPAIGN ─────────────────────────────────
 *
 * The audience is resolved once, when the campaign is created, and the
 * criteria are kept beside it. A lead edited next week does not change who a
 * campaign sent to last week — and the history has to be able to say what was
 * asked for, not just who answered.
 */

/** When a lead first entered the system. Never when it was last edited. */
export type DatePreset =
  | 'this_month' | 'last_month' | 'two_months_ago'
  | 'last_7_days' | 'last_30_days' | 'last_60_days' | 'last_90_days'
  | 'custom' | 'any'

export type AudienceFilter = {
  /** Added when. 'any' or absent means no date condition. */
  addedWithin?: DatePreset
  /** Only with 'custom'. Dates as YYYY-MM-DD, inclusive, in Accra. */
  addedFrom?: string | null
  addedTo?: string | null
  /** leads.status values. Several are alternatives. */
  statuses?: string[]
  /** leads.source values — the acquisition channel. */
  sources?: string[]
  /** leads.landing_source — how a lead arrived, e.g. a named import. */
  landingSources?: string[]
  /** leads.course_interest, matched exactly as recorded. */
  courses?: string[]
  /** leads.industry codes. */
  industries?: string[]
  /** leads.assigned_to — the staff member responsible. */
  owners?: string[]
}

export const DATE_PRESETS: ReadonlyArray<{ value: DatePreset; label: string }> = [
  { value: 'any', label: 'Any time' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'two_months_ago', label: 'Two months ago' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_60_days', label: 'Last 60 days' },
  { value: 'last_90_days', label: 'Last 90 days' },
  { value: 'custom', label: 'Between two dates' },
]

/**
 * The centre's own clock.
 *
 * Ghana keeps GMT all year with no daylight saving, so an Accra day and a UTC
 * day are the same day. That is stated rather than relied on silently: the
 * boundaries below are built from Accra's calendar, so "this month" means the
 * month it is in Accra even if that ever stops matching UTC.
 */
export const TIMEZONE = 'Africa/Accra'

/** The calendar date in Accra, as [year, month, day]. */
function accraParts(at: Date): [number, number, number] {
  const text = at.toLocaleDateString('en-CA', { timeZone: TIMEZONE })  // YYYY-MM-DD
  const [y, m, d] = text.split('-').map(Number)
  return [y, m, d]
}

/** Midnight at the start of an Accra date, as an instant. */
function accraMidnight(year: number, month: number, day: number): Date {
  // Accra is UTC+0, so the start of its day is the start of the UTC day.
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
}

export type DateRange = { fromISO: string | null; toISO: string | null }

/**
 * The window a preset means, as a half-open range [from, to).
 *
 * Half-open on purpose: a lead created at 23:59:59.400 on the last day of the
 * month belongs to that month, and an inclusive upper bound written as
 * 23:59:59 loses it. The end is the start of the following day instead.
 */
export function rangeFor(filter: AudienceFilter, now: Date = new Date()): DateRange {
  const preset = filter.addedWithin || 'any'
  if (preset === 'any') return { fromISO: null, toISO: null }

  const [y, m, d] = accraParts(now)

  if (preset === 'custom') {
    const from = (filter.addedFrom || '').trim()
    const to = (filter.addedTo || '').trim()
    const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
    return {
      fromISO: valid(from) ? accraMidnight(...(from.split('-').map(Number) as [number, number, number])).toISOString() : null,
      // Inclusive of the end date: the day after it, at midnight.
      toISO: valid(to)
        ? new Date(accraMidnight(...(to.split('-').map(Number) as [number, number, number])).getTime() + 86_400_000).toISOString()
        : null,
    }
  }

  if (preset === 'this_month') {
    return {
      fromISO: accraMidnight(y, m, 1).toISOString(),
      toISO: accraMidnight(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1).toISOString(),
    }
  }

  if (preset === 'last_month' || preset === 'two_months_ago') {
    const back = preset === 'last_month' ? 1 : 2
    // Month arithmetic through Date.UTC, so December going back two months
    // lands in October of the previous year rather than month -1.
    const start = new Date(Date.UTC(y, m - 1 - back, 1))
    const end = new Date(Date.UTC(y, m - back, 1))
    return { fromISO: start.toISOString(), toISO: end.toISOString() }
  }

  const days = { last_7_days: 7, last_30_days: 30, last_60_days: 60, last_90_days: 90 }[preset] as number
  /*
   * Counted in whole Accra days, ending at the start of tomorrow, so "last 7
   * days" is seven calendar days including today — not a rolling 168 hours,
   * which would exclude part of the day a lead was added seven days ago.
   */
  const tomorrow = accraMidnight(y, m, d).getTime() + 86_400_000
  return {
    fromISO: new Date(tomorrow - days * 86_400_000).toISOString(),
    toISO: new Date(tomorrow).toISOString(),
  }
}

/** Does this filter ask for anything at all? */
export function isEmptyFilter(filter: AudienceFilter): boolean {
  const lists = [filter.statuses, filter.sources, filter.landingSources, filter.courses, filter.industries, filter.owners]
  const noLists = lists.every(l => !l || l.length === 0)
  const noDates = !filter.addedWithin || filter.addedWithin === 'any'
  return noLists && noDates
}

/** The conditions, one per line, for the campaign record and the screen. */
export function describeFilter(
  filter: AudienceFilter,
  labels: { statuses?: Record<string, string>; owners?: Record<string, string>; industries?: Record<string, string> } = {},
): string[] {
  const out: string[] = []
  const preset = filter.addedWithin || 'any'

  if (preset === 'custom') {
    const from = filter.addedFrom || 'any date'
    const to = filter.addedTo || 'today'
    out.push(`Added between ${from} and ${to}`)
  } else if (preset !== 'any') {
    out.push(`Added ${(DATE_PRESETS.find(p => p.value === preset)?.label || preset).toLowerCase()}`)
  }

  const named = (values: string[] | undefined, what: string, map?: Record<string, string>) => {
    if (!values?.length) return
    out.push(`${what}: ${values.map(v => map?.[v] || v.replace(/_/g, ' ')).join(' or ')}`)
  }

  named(filter.statuses, 'Status', labels.statuses)
  named(filter.sources, 'Source')
  named(filter.landingSources, 'Came in through')
  named(filter.courses, 'Course of interest')
  named(filter.industries, 'Industry', labels.industries)
  named(filter.owners, 'Assigned to', labels.owners)

  if (!out.length) out.push('Every active lead')
  return out
}

/**
 * Does one lead match? The same rule the query applies, in one function.
 *
 * Used to test the query's behaviour against a known set of rows, so the
 * answer the screen shows and the people the campaign enrols cannot come from
 * two different ideas of what was asked for.
 */
export type MatchableLead = {
  created_at?: string | null
  status?: string | null
  source?: string | null
  landing_source?: string | null
  course_interest?: string | null
  industry?: string | null
  assigned_to?: string | null
}

export function matchesFilter(lead: MatchableLead, filter: AudienceFilter, now: Date = new Date()): boolean {
  const { fromISO, toISO } = rangeFor(filter, now)
  const created = lead.created_at ? new Date(lead.created_at).getTime() : null

  if (fromISO) {
    if (created === null || created < new Date(fromISO).getTime()) return false
  }
  if (toISO) {
    if (created === null || created >= new Date(toISO).getTime()) return false
  }

  const anyOf = (values: string[] | undefined, actual: string | null | undefined) => {
    if (!values?.length) return true
    return values.includes(String(actual ?? ''))
  }

  return anyOf(filter.statuses, lead.status)
    && anyOf(filter.sources, lead.source)
    && anyOf(filter.landingSources, lead.landing_source)
    && anyOf(filter.courses, lead.course_interest)
    && anyOf(filter.industries, lead.industry)
    && anyOf(filter.owners, lead.assigned_to)
}

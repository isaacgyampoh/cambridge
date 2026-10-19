/**
 * What a member of staff received, and what they converted.
 *
 * ── RECEIVED IS NOT CREATED ────────────────────────────────────────────────
 *
 * The marketer dashboard counted a month's leads by `leads.created_at` — when
 * the lead first entered the system, which may be long before anybody was
 * given it. A lead captured in August and handed to somebody in October
 * counted for August, in a month they had nothing to do with. `assigned_at`
 * is when a person RECEIVED it, and that is what "my leads this month" means.
 *
 * The two dates are kept apart here deliberately, and both are reported.
 *
 * ── CONVERTED MEANS REGISTERED, AND NEEDS A DATE ───────────────────────────
 *
 * `leads.status === 'registered'` says somebody converted; it does not say
 * WHEN, so it cannot answer "what did I convert in September". The obvious
 * source, lead_status_logs, does not have it either: completeApplication sets
 * the status directly and never logs the transition, so the single most
 * important change in the business was not recorded. Only manual status
 * edits are.
 *
 * The admission is. One is created for every completed registration, it
 * carries created_at, and it exists for the whole history — so it is the
 * conversion date, and the status is what makes it a conversion.
 *
 * ── MONTHS ─────────────────────────────────────────────────────────────────
 *
 * The centre runs a cohort a month and reports on calendar months. Accra is
 * UTC+0 all year, so UTC month boundaries and local ones are the same date;
 * this uses UTC and says so rather than pretending to a timezone it does not
 * apply.
 */

export type LeadRow = {
  id: string
  status?: string | null
  assigned_at?: string | null
  created_at?: string | null
  follow_up_at?: string | null
}

export type AdmissionRow = {
  lead_id?: string | null
  created_at?: string | null
}

export type MonthKey = string   // 'YYYY-MM'

export function monthKeyOf(iso: string | null | undefined): MonthKey | null {
  if (!iso) return null
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return null
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The last `count` months, newest first, as keys. */
export function recentMonths(now: Date, count = 12): MonthKey[] {
  const out: MonthKey[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export function monthLabel(key: MonthKey): string {
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

export type PeriodStats = {
  /** Leads this person was GIVEN in the period, by assigned_at. */
  received: number
  /** Leads that first entered the system in the period, by created_at. */
  created: number
  /** Of the leads received, how many are now registered. */
  converted: number
  /** Conversions that HAPPENED in the period, by the admission's date. */
  convertedInPeriod: number
  /** Still open and due a follow-up. */
  followUpsDue: number
  /** convertedInPeriod over received, as a percentage, or null when nothing came in. */
  conversionRate: number | null
  /** The lead ids behind each number, so a screen can show the records. */
  receivedIds: string[]
  convertedIds: string[]
}

const CONVERTED_STATUS = 'registered'
/** Statuses that mean the lead is finished with, one way or the other. */
const CLOSED = new Set(['registered', 'lost', 'not_interested', 'done'])

function emptyPeriod(): PeriodStats {
  return {
    received: 0, created: 0, converted: 0, convertedInPeriod: 0,
    followUpsDue: 0, conversionRate: null, receivedIds: [], convertedIds: [],
  }
}

function rate(converted: number, received: number): number | null {
  if (received <= 0) return null          // not zero: there was nothing to convert
  return Math.round((converted / received) * 1000) / 10
}

/**
 * One month, for one person.
 *
 * `admissionsByLead` maps a lead id to the date it converted. A lead with no
 * entry has not converted, whatever its status says — which is the honest
 * answer when the admission is missing, rather than counting it silently.
 */
export function statsForMonth(
  leads: LeadRow[],
  admissionsByLead: Map<string, string>,
  month: MonthKey,
  now: Date,
): PeriodStats {
  const out = emptyPeriod()

  for (const lead of leads || []) {
    if (monthKeyOf(lead.assigned_at) === month) {
      out.received++
      out.receivedIds.push(lead.id)
      if (lead.status === CONVERTED_STATUS) out.converted++
      if (!CLOSED.has(String(lead.status ?? '')) && lead.follow_up_at
          && new Date(lead.follow_up_at).getTime() <= now.getTime()) {
        out.followUpsDue++
      }
    }
    if (monthKeyOf(lead.created_at) === month) out.created++

    /*
     * Counted against the month the CONVERSION happened in, not the month the
     * lead arrived. A lead received in August that registers in October is
     * October's conversion — that is what a monthly cohort report means by
     * "what did we convert this month".
     */
    const convertedOn = admissionsByLead.get(lead.id)
    if (convertedOn && lead.status === CONVERTED_STATUS && monthKeyOf(convertedOn) === month) {
      out.convertedInPeriod++
      out.convertedIds.push(lead.id)
    }
  }

  out.conversionRate = rate(out.convertedInPeriod, out.received)
  return out
}

export type AllTimeStats = {
  received: number
  converted: number
  conversionRate: number | null
  /** Received but never given a date — they cannot be placed in any month. */
  undated: number
}

export function statsAllTime(leads: LeadRow[], admissionsByLead: Map<string, string>): AllTimeStats {
  const all = leads || []
  const converted = all.filter(l =>
    l.status === CONVERTED_STATUS && admissionsByLead.has(l.id)).length
  /*
   * Reported rather than hidden. A lead with no assigned_at is one this
   * person holds that no month will ever account for, so the monthly figures
   * will not add up to the total — and saying so is better than letting
   * somebody discover the gap and distrust both numbers.
   */
  const undated = all.filter(l => !l.assigned_at).length
  return {
    received: all.length,
    converted,
    conversionRate: rate(converted, all.length),
    undated,
  }
}

/** Every month at once, for the cohort view. */
export function monthlySeries(
  leads: LeadRow[],
  admissionsByLead: Map<string, string>,
  months: MonthKey[],
  now: Date,
): { month: MonthKey; label: string; received: number; convertedInPeriod: number; conversionRate: number | null }[] {
  return months.map(m => {
    const s = statsForMonth(leads, admissionsByLead, m, now)
    return {
      month: m, label: monthLabel(m),
      received: s.received, convertedInPeriod: s.convertedInPeriod,
      conversionRate: s.conversionRate,
    }
  })
}

export type Range = { startISO: string; endISO: string }

/**
 * A calendar month, which is what a monthly cohort actually is.
 *
 * generateReports took "monthly" to mean `setMonth(now.getMonth() - 1)` — the
 * last thirty-ish days, sliding, ending today. Two reports run a day apart
 * covered different windows and could not be compared, and neither was "what
 * we did in September". The centre runs a cohort a month and reports on
 * months, so a month is what this returns.
 */
export function calendarMonth(key: MonthKey): Range {
  const [y, m] = key.split('-').map(Number)
  return {
    startISO: new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0)).toISOString(),
    endISO: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString(),
  }
}

/** The sliding windows the daily and weekly reports genuinely want. */
export function slidingRange(now: Date, days: number): Range {
  return {
    startISO: new Date(now.getTime() - days * 86400000).toISOString(),
    endISO: now.toISOString(),
  }
}

const inRange = (iso: string | null | undefined, r: Range): boolean => {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  // Half-open: the end instant belongs to the next period, so consecutive
  // periods cannot both claim the same lead.
  return t >= new Date(r.startISO).getTime() && t < new Date(r.endISO).getTime()
}

/**
 * The same figures as statsForMonth, over an arbitrary period.
 *
 * Conversions are counted by WHEN THEY HAPPENED, from the admission date —
 * not by "leads assigned in this period that are registered today", which is
 * what the report generator did. Under that rule a lead assigned in September
 * and registered in October belonged to neither report: October never saw it
 * because it was not assigned in October, and September's had already been
 * written. Conversions went missing, which is how a report comes to say two
 * leads converted and nought converted in the same breath.
 */
export function statsForRange(
  leads: LeadRow[],
  admissionsByLead: Map<string, string>,
  range: Range,
  now: Date,
): PeriodStats {
  const out: PeriodStats = {
    received: 0, created: 0, converted: 0, convertedInPeriod: 0,
    followUpsDue: 0, conversionRate: null, receivedIds: [], convertedIds: [],
  }

  for (const lead of leads || []) {
    if (inRange(lead.assigned_at, range)) {
      out.received++
      out.receivedIds.push(lead.id)
      if (lead.status === 'registered') out.converted++
      if (!CLOSED.has(String(lead.status ?? '')) && lead.follow_up_at
          && new Date(lead.follow_up_at).getTime() <= now.getTime()) {
        out.followUpsDue++
      }
    }
    if (inRange(lead.created_at, range)) out.created++

    const convertedOn = admissionsByLead.get(lead.id)
    if (convertedOn && lead.status === 'registered' && inRange(convertedOn, range)) {
      out.convertedInPeriod++
      out.convertedIds.push(lead.id)
    }
  }

  out.conversionRate = rate(out.convertedInPeriod, out.received)
  return out
}

/** How a rate reads when there was nothing to convert. */
export function rateLabel(rate: number | null): string {
  return rate === null ? 'no leads received' : `${rate}%`
}

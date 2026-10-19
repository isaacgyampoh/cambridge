import { createServiceClient } from '@/lib/supabase/server'
import { eligibleMarketers } from '@/lib/leads/eligibility'
import {
  statsForRange, calendarMonth, slidingRange, monthKeyOf, rateLabel,
  type LeadRow, type Range,
} from '@/lib/analytics/leadStats'

/**
 * The periodic report on each person who works leads.
 *
 * ── WHAT WAS WRONG WITH IT ─────────────────────────────────────────────────
 *
 * It was described as meaningless, and it was, for three separate reasons.
 *
 * ONE: it reported on everybody. The pool was "every active profile that is
 * not a super admin", so a report was written for students, receptionists,
 * administrators and anyone else on the staff list — none of whom hold a
 * leads portal, all of whom scored nought. A list mostly made of empty
 * reports for people who do not work leads is a list nobody reads.
 * eligibleMarketers() has been the single source of truth for who works
 * leads since RC-1; this never adopted it.
 *
 * TWO: conversions went missing. `converted` counted leads ASSIGNED in the
 * period that are registered TODAY. A lead assigned in September and
 * registered in October belonged to neither report — October never saw it,
 * because it was not assigned in October, and September's had already been
 * written. That is how a report comes to show leads handled and nought
 * converted in the same breath.
 *
 * THREE: "monthly" meant the last thirty-ish days, sliding, ending today. Two
 * reports a day apart covered different windows and could not be compared to
 * each other, and neither was "what we did in September". The centre runs a
 * cohort a month.
 *
 * Conversions are dated from the admission now — the record written once per
 * registration — through the same tested helper the staff figures use, so a
 * report and a dashboard cannot disagree about the same person.
 */

export type ReportPeriod = 'daily' | 'weekly' | 'monthly'

function rangeFor(period: ReportPeriod, now: Date): Range {
  if (period === 'monthly') return calendarMonth(monthKeyOf(now.toISOString()) as string)
  return slidingRange(now, period === 'daily' ? 1 : 7)
}

export async function generateReports(period: ReportPeriod) {
  const sb = createServiceClient()
  const now = new Date()
  const range = rangeFor(period, now)
  const periodStart = range.startISO.slice(0, 10)
  const periodEnd = range.endISO.slice(0, 10)

  /*
   * Only the people who actually work leads. One source of truth, shared with
   * assignment, so a report cannot be written for somebody the system would
   * never give a lead to.
   */
  let pool: { id: string; full_name?: string | null }[]
  try {
    pool = await eligibleMarketers()
  } catch (e) {
    console.error('[reports] the lead pool could not be read:', e)
    return { generated: 0, skipped: 'The staff list could not be read.' }
  }
  if (!pool.length) return { generated: 0, skipped: 'Nobody is set up to receive leads.' }

  let generated = 0
  const failures: string[] = []

  for (const m of pool) {
    /*
     * Everything this person holds, not only what arrived in the period: a
     * conversion this month may belong to a lead received months ago, and
     * the window is applied to the DATES rather than to the query.
     */
    const { data: leadRows } = await sb.from('leads')
      .select('id, status, assigned_at, created_at, follow_up_at')
      .eq('assigned_to', m.id).limit(5000)
    const leads = (leadRows || []) as LeadRow[]

    // When each of them converted. leads.status says that one did, never when.
    const ids = leads.map(l => l.id)
    const byLead = new Map<string, string>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data: adm } = await sb.from('admissions')
        .select('lead_id, created_at').in('lead_id', ids.slice(i, i + 200))
      for (const a of adm || []) {
        const lid = a.lead_id as string | null
        const at = a.created_at as string | null
        if (!lid || !at) continue
        const held = byLead.get(lid)
        if (!held || at < held) byLead.set(lid, at)
      }
    }

    const s = statsForRange(leads, byLead, range, now)

    const { count: calls } = await sb.from('lead_activities')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', m.id).eq('activity_type', 'call')
      .gte('created_at', range.startISO).lt('created_at', range.endISO)

    let points = 0
    try {
      const { data: pts } = await sb.from('marketer_enrollments')
        .select('points').eq('marketer_id', m.id)
        .gte('created_at', range.startISO).lt('created_at', range.endISO)
      points = (pts || []).reduce((sum: number, p: { points?: number }) => sum + (p.points || 0), 0)
    } catch { /* points are not tracked everywhere */ }

    const first = String(m.full_name || 'They').split(' ')[0]
    const word = period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month'

    /*
     * Said in words a person can act on, and honest when there is nothing to
     * report. "0%" where nothing came in is the line that made these useless:
     * it reads as a failure to convert rather than as an empty month.
     */
    const summary = s.received === 0
      ? `${first} received no leads this ${word}.` +
        (s.convertedInPeriod > 0
          ? ` ${s.convertedInPeriod} lead${s.convertedInPeriod === 1 ? '' : 's'} received earlier registered this ${word}.`
          : '') +
        (calls ? ` ${calls} call${calls === 1 ? '' : 's'} logged.` : '')
      : `${first} received ${s.received} lead${s.received === 1 ? '' : 's'} this ${word}: ` +
        `${s.convertedInPeriod} registered (${rateLabel(s.conversionRate)}), ` +
        `${calls || 0} call${calls === 1 ? '' : 's'} logged` +
        (s.followUpsDue ? `, ${s.followUpsDue} follow-up${s.followUpsDue === 1 ? '' : 's'} due` : '') + '.'

    const { error } = await sb.from('marketer_reports').upsert({
      marketer_id: m.id, period, period_start: periodStart, period_end: periodEnd,
      new_leads: s.received,
      // Anything that is no longer untouched.
      contacted: leads.filter(l =>
        l.status !== 'new' && s.receivedIds.includes(l.id)).length,
      converted: s.convertedInPeriod,
      calls_made: calls || 0,
      points_earned: points,
      summary,
    }, { onConflict: 'marketer_id,period,period_start' })

    if (error) { failures.push(`${m.full_name}: ${error.message}`); continue }
    generated++
  }

  /*
   * Reported rather than swallowed. The previous version wrapped the write in
   * a bare try/catch, so a report that failed to save was indistinguishable
   * from one that was never due.
   */
  if (failures.length) console.error('[reports] not saved:', failures.join('; '))
  return { generated, failed: failures.length, period, periodStart, periodEnd }
}

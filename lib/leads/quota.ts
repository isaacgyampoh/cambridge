import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * A MEMBER'S TARGET FOR THE PERIOD, AND WHAT THEY HAVE DONE AGAINST IT.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * marketer_targets has been in the schema since schema-v3 and has row level
 * security enabled on it, and NOTHING in the application has ever referenced
 * it. A target could be stored and was never read, never shown and never
 * enforced — so "what is my quota?" had no answer anywhere in the portal, for
 * anybody.
 *
 * This reads it. It does not invent a second quota model, a billing model or
 * a new table: the target is whatever somebody put in marketer_targets for a
 * period covering today.
 *
 * ── WHAT COUNTS AS USED ────────────────────────────────────────────────────
 *
 * Leads RECEIVED in the period, counted from lead_assignments — the record of
 * what was handed out — rather than from leads.assigned_to, which says who
 * holds a lead now and changes on every reassignment. The lead distribution
 * dashboard counts the same events, so the two screens cannot disagree about
 * how many leads somebody got.
 *
 * Conversions are registrations credited in the period, from the enrolment
 * records that already drive remuneration.
 */

export type Quota = {
  /** Null when nobody has set a target covering today. */
  target: number | null
  targetConversions: number | null
  used: number
  conversions: number
  remaining: number | null
  periodLabel: string | null
  periodStart: string | null
  periodEnd: string | null
}

export type QuotaResult =
  | { ok: true; quota: Quota }
  | { ok: false; reason: string }

/** Postgres/PostgREST codes for "that table is not there". */
const MISSING_TABLE = new Set(['42P01', 'PGRST205'])

function missing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return MISSING_TABLE.has(String(error.code))
    || /does not exist|Could not find the table/i.test(error.message || '')
}

export async function readQuota(marketerId: string): Promise<QuotaResult> {
  const sb = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)

  /*
   * The target covering today. Most recently started wins if somebody has
   * overlapping periods, which is the one a person would mean.
   */
  const { data: targets, error: targetError } = await sb.from('marketer_targets')
    .select('period, period_start, period_end, target_leads, target_conversions')
    .eq('marketer_id', marketerId)
    .lte('period_start', today)
    .gte('period_end', today)
    .order('period_start', { ascending: false })
    .limit(1)

  /*
   * A table that is not there is "no target has ever been set", which is a
   * real state worth showing. Any OTHER failure is a failure, and must not be
   * rendered as a quota of zero — that would read as somebody's target having
   * been wiped.
   */
  if (targetError && !missing(targetError)) {
    return { ok: false, reason: targetError.message }
  }

  const target = targets?.[0] || null
  const periodStart = target?.period_start ?? startOfMonth()
  const periodEnd = target?.period_end ?? endOfMonth()

  /*
   * What they received in the period. Counted even when no target is set, so
   * the figure is useful before anybody configures one.
   */
  const { count: used, error: usedError } = await sb.from('lead_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('to_marketer', marketerId)
    .gte('created_at', `${periodStart}T00:00:00.000Z`)
    .lte('created_at', `${periodEnd}T23:59:59.999Z`)

  if (usedError) return { ok: false, reason: usedError.message }

  const { count: conversions, error: convError } = await sb.from('marketer_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('marketer_id', marketerId)
    .gte('created_at', `${periodStart}T00:00:00.000Z`)
    .lte('created_at', `${periodEnd}T23:59:59.999Z`)

  // Enrolments are a nice-to-have on this figure; a missing table is not a
  // failure of the quota itself.
  if (convError && !missing(convError)) return { ok: false, reason: convError.message }

  const targetLeads = target?.target_leads != null ? Number(target.target_leads) : null

  return {
    ok: true,
    quota: {
      target: targetLeads,
      targetConversions: target?.target_conversions != null ? Number(target.target_conversions) : null,
      used: used ?? 0,
      conversions: conversions ?? 0,
      // Never negative: somebody who exceeded their target has none left, not
      // a debt.
      remaining: targetLeads === null ? null : Math.max(0, targetLeads - (used ?? 0)),
      periodLabel: (target?.period as string) ?? 'this month',
      periodStart, periodEnd,
    },
  }
}

function startOfMonth(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

function endOfMonth(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
}

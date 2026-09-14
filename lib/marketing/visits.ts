import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Anonymous record of a marketing link being opened.
 *
 * ── ZERO AND "NOT COUNTING" ARE DIFFERENT ANSWERS ──────────────────────────
 *
 * This is the whole reason the reads below return a shape rather than a
 * number. marketing_visits ships in 0019, and code deploys before migrations
 * run — so there is a window where nothing is being recorded at all.
 *
 * A panel that showed "0 visits" during that window would be stating
 * something false, and it is the most damaging kind of false: a marketer
 * concludes their link does not work, stops sharing it, and the number stays
 * at zero for a reason that has nothing to do with them.
 *
 * So "not being recorded yet" is a distinct state that the screens render as
 * itself. The same distinction the rest of this codebase draws between a
 * failed read and an absent row, one layer up.
 */

export type VisitCount =
  | { counting: true; visits: number; sessions: number }
  /** The table is not there yet, or could not be read. NOT zero. */
  | { counting: false; reason: string }

function notCounting(error: { message: string }): VisitCount | null {
  if (/does not exist|could not find|schema cache/i.test(error.message)) {
    return {
      counting: false,
      reason: 'Visits are not being recorded yet — run migration 0019.',
    }
  }
  return null
}

/**
 * Record one visit.
 *
 * Best-effort by design: a marketing page must never fail because a counter
 * did. Everything here is swallowed after being logged.
 *
 * The unique index on (code, session, day) does the de-duplication, so a
 * person refreshing is one visit — which is why a duplicate-key error is a
 * success and not a problem.
 */
export async function recordVisit(opts: {
  marketerCode: string
  sessionId: string
  courseId?: string | null
  referrerHost?: string | null
}): Promise<void> {
  try {
    const sb = createServiceClient()
    const { error } = await sb.from('marketing_visits').insert({
      marketer_code: opts.marketerCode,
      session_id: opts.sessionId,
      course_id: opts.courseId || null,
      referrer_host: opts.referrerHost || null,
    })

    if (!error) return

    // Already counted today. That is the index working.
    if (/duplicate key|unique constraint/i.test(error.message)) return

    if (notCounting(error)) {
      console.error('[marketing] visits not recorded —', error.message,
        '— run supabase/migrations/0019_marketing_visits.sql')
      return
    }
    console.error('[marketing] could not record visit:', error.message)
  } catch (e) {
    console.error('[marketing] could not record visit:', e)
  }
}

/** How one member of staff's link has been doing. */
export async function visitsForCode(code: string, days = 30): Promise<VisitCount> {
  try {
    const sb = createServiceClient()
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    const { data, error } = await sb.from('marketing_visits')
      .select('session_id')
      .eq('marketer_code', code)
      .gte('created_at', since)
      .limit(5000)

    if (error) {
      return notCounting(error) ?? { counting: false, reason: 'Visits could not be loaded just now.' }
    }

    const rows = data || []
    return {
      counting: true,
      visits: rows.length,
      sessions: new Set(rows.map(r => r.session_id)).size,
    }
  } catch (e) {
    return { counting: false, reason: e instanceof Error ? e.message : 'Visits could not be loaded.' }
  }
}

export type MarketingRow = {
  code: string
  visits: number
}

/**
 * Visits per link, for the administrator's comparison across staff.
 *
 * Returns null when nothing is being counted, so the admin screen can say so
 * rather than render a table of zeroes that reads as "nobody is working".
 */
export async function visitsByCode(days = 30): Promise<MarketingRow[] | null> {
  try {
    const sb = createServiceClient()
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    const { data, error } = await sb.from('marketing_visits')
      .select('marketer_code')
      .gte('created_at', since)
      .limit(20_000)

    if (error) {
      console.error('[marketing] visits by code unavailable:', error.message)
      return null
    }

    const counts = new Map<string, number>()
    for (const r of data || []) {
      const code = String(r.marketer_code || '')
      if (code) counts.set(code, (counts.get(code) || 0) + 1)
    }
    return [...counts.entries()].map(([code, visits]) => ({ code, visits }))
  } catch (e) {
    console.error('[marketing] visits by code unavailable:', e)
    return null
  }
}

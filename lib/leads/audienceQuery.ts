import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { normaliseRecipient } from '@/lib/integrations/sms'
import { rangeFor, type AudienceFilter } from '@/lib/leads/audienceFilter'

/**
 * RESOLVING A SELECTION AGAINST THE ACTUAL LEADS.
 *
 * ── ONE QUERY, TWO READERS ─────────────────────────────────────────────────
 *
 * The count the screen shows and the people the campaign enrols come from
 * this one function. Counting in the browser over a page of loaded leads —
 * which is what a filtered list would otherwise do — gives a number that is
 * right about the page and wrong about the campaign, and the operator finds
 * out after pressing Send.
 */

export type AudienceLead = {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  status: string | null
  source: string | null
  landing_source: string | null
  course_interest: string | null
  industry: string | null
  assigned_to: string | null
  created_at: string | null
}

export type ResolvedAudience = {
  /** Everybody the conditions matched. */
  matching: number
  /** Of those, the ones with a number a text can go to. */
  sendable: AudienceLead[]
  /** And the ones without, kept so the operator can see why. */
  excluded: Array<AudienceLead & { reason: string }>
}

const SELECT = 'id, full_name, phone, email, status, source, landing_source, course_interest, industry, assigned_to, created_at'

/** A ceiling, so one campaign cannot try to be the whole database. */
export const AUDIENCE_LIMIT = 5000

/**
 * Who this filter selects.
 *
 * Each condition narrows the last. Within a condition the values are
 * alternatives, which is `in`; between conditions they combine with AND,
 * which is how chained filters already behave.
 */
export async function resolveAudience(
  filter: AudienceFilter,
  now: Date = new Date(),
): Promise<ResolvedAudience | { error: string }> {
  const sb = createServiceClient()
  const { fromISO, toISO } = rangeFor(filter, now)

  /*
   * Built in one chain rather than reassigned through a dozen conditionals:
   * reassigning the builder deepens its type on every line until the checker
   * gives up on the file.
   */
  const conditions: Array<[string, string[]]> = [
    ['status', filter.statuses || []],
    ['source', filter.sources || []],
    ['landing_source', filter.landingSources || []],
    ['course_interest', filter.courses || []],
    ['industry', filter.industries || []],
    ['assigned_to', filter.owners || []],
  ]

  let q = sb.from('leads').select(SELECT)
  if (fromISO) q = q.gte('created_at', fromISO)
  if (toISO) q = q.lt('created_at', toISO)
  for (const [column, values] of conditions) {
    if (values.length) q = q.in(column, values)
  }

  const { data, error } = await q.order('created_at', { ascending: false }).limit(AUDIENCE_LIMIT)
  if (error) {
    console.error('[audience] query failed:', error.message)
    return { error: 'The matching leads could not be counted just now. Please try again.' }
  }

  const rows = (data as AudienceLead[]) || []
  const sendable: AudienceLead[] = []
  const excluded: Array<AudienceLead & { reason: string }> = []

  /*
   * One row per lead even if two conditions would both have matched them —
   * the query cannot return a lead twice, and the id is checked anyway
   * because an audience assembled from several sources later must not be able
   * to message anybody twice.
   */
  const seen = new Set<string>()
  for (const lead of rows) {
    if (seen.has(lead.id)) continue
    seen.add(lead.id)

    if (normaliseRecipient(lead.phone || '')) sendable.push(lead)
    else {
      excluded.push({
        ...lead,
        reason: lead.phone ? 'The number is not a Ghanaian mobile' : 'No phone number on the record',
      })
    }
  }

  return { matching: seen.size, sendable, excluded }
}

/** The distinct values a filter can offer, read from the leads themselves. */
export async function audienceOptions(): Promise<{
  statuses: string[]; sources: string[]; landingSources: string[]
  courses: string[]; industries: string[]
  owners: Array<{ id: string; name: string }>
} | { error: string }> {
  const sb = createServiceClient()

  const { data, error } = await sb.from('leads')
    .select('status, source, landing_source, course_interest, industry, assigned_to')
    .limit(AUDIENCE_LIMIT)
  if (error) {
    console.error('[audience] options failed:', error.message)
    return { error: 'The filter options could not be loaded just now.' }
  }

  const distinct = (key: keyof NonNullable<typeof data>[number]) =>
    [...new Set((data || []).map(r => String(r[key] ?? '').trim()).filter(Boolean))].sort()

  const ownerIds = [...new Set((data || []).map(r => r.assigned_to).filter(Boolean) as string[])]
  const owners: Array<{ id: string; name: string }> = []
  if (ownerIds.length) {
    const { data: staff } = await sb.from('profiles').select('id, full_name').in('id', ownerIds)
    for (const s of staff || []) owners.push({ id: s.id as string, name: (s.full_name as string) || 'Unnamed' })
    owners.sort((a, b) => a.name.localeCompare(b.name))
  }

  return {
    statuses: distinct('status'),
    sources: distinct('source'),
    landingSources: distinct('landing_source'),
    courses: distinct('course_interest'),
    industries: distinct('industry'),
    owners,
  }
}

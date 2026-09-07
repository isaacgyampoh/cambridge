import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { resolvePortals } from '@/lib/access/portals'
import { DEFAULT_TIER, weightForTier } from '@/lib/leads/selection'

export { TIER_WEIGHT, DEFAULT_TIER, pickRecipient } from '@/lib/leads/selection'

/**
 * Who is eligible to receive a lead.
 *
 * This is THE root cause of "some staff receive leads and others do not".
 * The old pool was built as:
 *
 *     .neq('role', 'super_admin').eq('is_active', true)
 *
 * — every active profile that is not a super admin. Trainers, accountants,
 * receptionists, exam coordinators, content managers and students were all
 * eligible. The only opt-out was `in_lead_pool !== false`, and that column is
 * NULL for anyone never explicitly configured; NULL is not false, so they
 * stayed in the pool.
 *
 * Leads were therefore not being lost. They were assigned, recorded correctly,
 * and then sat on the dashboard of somebody with no leads page and no reason
 * to look — which from the marketing team's side is indistinguishable from the
 * lead never arriving.
 *
 * Eligibility now derives from the portal system that already governs both the
 * navigation and the route guard: you can receive a lead only if your resolved
 * portals include `my_leads`. One source of truth, so it cannot drift.
 */

export type Candidate = {
  id: string
  fullName: string
  role: string
  tier: string
  weight: number
}

/*
 * Imported, not restated.
 *
 * lib/data/policy decides whether you may READ a lead from this same
 * constant, and this file decides whether you may RECEIVE one. Two copies of
 * the answer is precisely the shape that caused the bug both are now fixing:
 * a content manager the distributor picked and the data layer refused.
 */
export { LEADS_PORTAL } from '@/lib/data/policy'
import { LEADS_PORTAL } from '@/lib/data/policy'

export type EligibilityOptions = {
  /** 'google' and 'website' can be restricted to specifically flagged staff. */
  source?: string | null
}

/**
 * Resolve the candidate pool for a new lead.
 *
 * Returns candidates in a stable order (by id) so that callers and tests see
 * a deterministic list.
 */
export async function eligibleMarketers(opts: EligibilityOptions = {}): Promise<Candidate[]> {
  const sb = createServiceClient()

  const { data: staff } = await sb.from('profiles')
    .select('id, full_name, role, portals, is_active, in_lead_pool, performance_tier, gets_google_leads, gets_website_leads')
    .eq('is_active', true)

  type Row = {
    id: string; full_name: string; role: string; portals: string[] | null
    in_lead_pool: boolean | null; performance_tier: string | null
    gets_google_leads: boolean | null; gets_website_leads: boolean | null
  }

  let pool = (staff || []).filter((m: Row) => {
    // Super admins run the system; they are not a destination for leads.
    if (m.role === 'super_admin') return false
    // An explicit opt-out always wins.
    if (m.in_lead_pool === false) return false
    // The decisive test: do they actually have a leads portal?
    return resolvePortals(m.role, m.portals).includes(LEADS_PORTAL)
  }) as Row[]

  // Source routing: Google and website leads can be reserved for named staff.
  // If nobody is flagged, fall back to the whole pool rather than losing leads.
  const src = (opts.source || '').toLowerCase()
  if (src === 'google') {
    const exclusive = pool.filter(m => m.gets_google_leads === true)
    if (exclusive.length) pool = exclusive
  } else if (src === 'website') {
    const exclusive = pool.filter(m => m.gets_website_leads === true)
    if (exclusive.length) pool = exclusive
  }

  return pool
    .map(m => {
      const tier = m.performance_tier || DEFAULT_TIER
      return {
        id: m.id,
        fullName: m.full_name,
        role: m.role,
        tier,
        weight: weightForTier(tier),
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** Is this specific person allowed to receive a lead directly? */
export async function isEligible(marketerId: string): Promise<boolean> {
  const sb = createServiceClient()
  const { data: m } = await sb.from('profiles')
    .select('id, role, portals, is_active, in_lead_pool')
    .eq('id', marketerId).maybeSingle()
  if (!m || m.is_active === false) return false
  if (m.role === 'super_admin') return false
  if (m.in_lead_pool === false) return false
  return resolvePortals(m.role, m.portals).includes(LEADS_PORTAL)
}

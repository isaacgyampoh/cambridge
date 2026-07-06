import { createServiceClient } from '@/lib/supabase/server'

/**
 * Recalculate performance tiers from recent conversion performance.
 * Ranks active pool members by conversion rate (registered / assigned) over
 * the last 30 days, then splits: top third -> high, middle -> mid, bottom ->
 * low. Non-marketer support roles (that still convert) stay 'support' unless
 * they're actively converting. Manual override respected via tier_locked.
 */
export async function recalcTiers() {
  const sb = createServiceClient()
  const since = new Date(Date.now() - 30 * 864e5).toISOString()

  const { data: pool } = await sb.from('profiles')
    .select('id, role, performance_tier, in_lead_pool, tier_locked')
    .neq('role', 'super_admin').eq('is_active', true)
  if (!pool?.length) return { updated: 0 }

  // Pull leads assigned in the window
  const { data: leads } = await sb.from('leads')
    .select('assigned_to, status, assigned_at')
    .not('assigned_to', 'is', null)
    .gte('assigned_at', since)
    .limit(20000)

  const stats: Record<string, { assigned: number; won: number }> = {}
  for (const p of pool) stats[p.id] = { assigned: 0, won: 0 }
  for (const l of leads || []) {
    const s = stats[l.assigned_to as string]
    if (!s) continue
    s.assigned++
    if (l.status === 'registered') s.won++
  }

  // Score = conversion rate; needs a minimum of assigned leads to rank fairly
  const scored = pool
    .filter(p => p.in_lead_pool !== false && !p.tier_locked)
    .map(p => {
      const s = stats[p.id]
      const rate = s.assigned >= 3 ? s.won / s.assigned : -1  // too few leads -> unranked
      return { id: p.id, role: p.role, rate, assigned: s.assigned, won: s.won }
    })

  // Support roles (non-marketing) default to 'support' unless converting well
  const MARKETING_ROLES = ['marketing_officer']
  const rankable = scored.filter(p => p.rate >= 0)
  rankable.sort((a, b) => b.rate - a.rate)

  const updates: { id: string; tier: string }[] = []
  const n = rankable.length
  rankable.forEach((p, i) => {
    let tier: string
    if (n < 3) tier = 'mid'                       // too few to tier — keep mid
    else if (i < Math.ceil(n / 3)) tier = 'high'
    else if (i < Math.ceil((2 * n) / 3)) tier = 'mid'
    else tier = 'low'
    // Non-marketers who don't convert stay 'support'
    if (!MARKETING_ROLES.includes(p.role) && p.won === 0) tier = 'support'
    updates.push({ id: p.id, tier })
  })

  // People with too few leads to rank: marketers -> keep current; support roles -> support
  for (const p of scored.filter(p => p.rate < 0)) {
    if (!MARKETING_ROLES.includes(p.role)) updates.push({ id: p.id, tier: 'support' })
  }

  for (const u of updates) {
    await sb.from('profiles').update({ performance_tier: u.tier }).eq('id', u.id)
  }
  return { updated: updates.length }
}

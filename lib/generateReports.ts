import { createServiceClient } from '@/lib/supabase/server'

/**
 * Auto-generate marketer activity reports for a period. Pulls each pool
 * member's leads/calls/conversions from their activity and writes a report
 * row + a short plain-language summary. Idempotent per (marketer, period,
 * start) via upsert.
 */
export async function generateReports(period: 'daily' | 'weekly' | 'monthly') {
  const sb = createServiceClient()
  const now = new Date()
  let start = new Date()
  if (period === 'daily') start.setDate(now.getDate() - 1)
  else if (period === 'weekly') start.setDate(now.getDate() - 7)
  else start.setMonth(now.getMonth() - 1)

  const startISO = start.toISOString()
  const startDate = start.toISOString().slice(0, 10)
  const endDate = now.toISOString().slice(0, 10)

  const { data: pool } = await sb.from('profiles')
    .select('id, full_name, in_lead_pool')
    .neq('role', 'super_admin').eq('is_active', true)
  const marketers = (pool || []).filter(m => m.in_lead_pool !== false)
  if (!marketers.length) return { generated: 0 }

  let generated = 0
  for (const m of marketers) {
    // Leads assigned in the period
    const { data: leads } = await sb.from('leads')
      .select('status, assigned_at, updated_at')
      .eq('assigned_to', m.id).gte('assigned_at', startISO).limit(2000)

    const newLeads = (leads || []).length
    const contacted = (leads || []).filter((l: any) => l.status !== 'new').length
    const converted = (leads || []).filter((l: any) => l.status === 'registered').length

    // Activities (calls) in the period
    const { count: calls } = await sb.from('lead_activities')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', m.id).eq('activity_type', 'call').gte('created_at', startISO)

    // Points earned in the period (if tracked)
    let points = 0
    try {
      const { data: pts } = await sb.from('marketer_enrollments')
        .select('points').eq('marketer_id', m.id).gte('created_at', startISO)
      points = (pts || []).reduce((s: number, p: any) => s + (p.points || 0), 0)
    } catch {}

    const rate = newLeads ? Math.round((converted / newLeads) * 100) : 0
    const summary = `${m.full_name.split(' ')[0]} handled ${newLeads} lead${newLeads === 1 ? '' : 's'} this ${period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month'}: ${contacted} contacted, ${converted} converted (${rate}%), ${calls || 0} call${calls === 1 ? '' : 's'} logged.`

    try {
      await sb.from('marketer_reports').upsert({
        marketer_id: m.id, period, period_start: startDate, period_end: endDate,
        new_leads: newLeads, contacted, converted, calls_made: calls || 0,
        points_earned: points, summary,
      }, { onConflict: 'marketer_id,period,period_start' })
      generated++
    } catch {}
  }
  return { generated }
}

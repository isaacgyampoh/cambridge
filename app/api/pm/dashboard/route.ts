import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const ALLOWED = ['super_admin', 'project_manager']

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()

  const [{ data: leads }, { data: marketers }, { data: admissions }] = await Promise.all([
    sb.from('leads').select('status, assigned_to, created_at, updated_at').limit(8000),
    sb.from('profiles').select('id, full_name').eq('is_active', true).neq('role', 'super_admin').limit(500),
    sb.from('admissions').select('status').limit(5000),
  ])

  const all = leads || []
  const totalLeads = all.length
  const unassigned = all.filter((l: any) => !l.assigned_to).length
  const registered = all.filter((l: any) => l.status === 'registered').length
  const newThisWeek = all.filter((l: any) => new Date(l.created_at).getTime() > Date.now() - 7 * 864e5).length
  const cutoff = Date.now() - 5 * 864e5
  const cold = all.filter((l: any) => !['registered', 'lost', 'not_interested', 'done'].includes(l.status) && new Date(l.updated_at).getTime() < cutoff).length

  // Team leaderboard (by registered conversions)
  const byMarketer: Record<string, { total: number; won: number }> = {}
  for (const l of all) {
    if (!l.assigned_to) continue
    byMarketer[l.assigned_to] = byMarketer[l.assigned_to] || { total: 0, won: 0 }
    byMarketer[l.assigned_to].total++
    if (l.status === 'registered') byMarketer[l.assigned_to].won++
  }
  const nameOf: Record<string, string> = {}
  for (const m of marketers || []) nameOf[m.id] = m.full_name
  const leaderboard = Object.entries(byMarketer)
    .map(([id, v]) => ({ name: nameOf[id] || 'Unknown', total: v.total, won: v.won }))
    .sort((a, b) => b.won - a.won).slice(0, 6)

  const pendingAdmissions = (admissions || []).filter((a: any) => a.status === 'pending').length

  const conversionRate = totalLeads ? Math.round(registered / totalLeads * 100) : 0

  // ── Sub-PM oversight ──
  // If this PM is a team lead, surface the people who report to them, each
  // with their own lead activity, so the main PM sees everything they do.
  let subTeam: any[] = []
  try {
    const { data: subs } = await sb.from('profiles')
      .select('id, full_name, role, performance_tier')
      .eq('reports_to', session.userId).eq('is_active', true).limit(100)
    subTeam = (subs || []).map((s: any) => {
      const stat = byMarketer[s.id] || { total: 0, won: 0 }
      return {
        id: s.id, full_name: s.full_name, role: s.role, tier: s.performance_tier,
        leads: stat.total, converted: stat.won,
        rate: stat.total ? Math.round((stat.won / stat.total) * 100) : 0,
      }
    })
  } catch { /* hierarchy columns optional */ }

  return NextResponse.json({
    totalLeads, unassigned, registered, newThisWeek, cold,
    conversionRate, pendingAdmissions, leaderboard,
    teamSize: (marketers || []).length,
    subTeam,
  })
}

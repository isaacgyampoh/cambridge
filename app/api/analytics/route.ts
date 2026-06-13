import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const days = parseInt(new URL(req.url).searchParams.get('days') || '30')
  const since = new Date(Date.now() - days * 86400000).toISOString()

  const [leadsR, paymentsR, admissionsR, profilesR, activitiesR] = await Promise.all([
    sb.from('leads').select('id, status, source, created_at, assigned_to').gte('created_at', since),
    sb.from('payments').select('amount, status, method, paid_at, created_at').gte('created_at', since),
    sb.from('admissions').select('id, status, created_at').gte('created_at', since),
    sb.from('profiles').select('id, role, is_active'),
    sb.from('lead_activities').select('id, activity_type, created_at, created_by').gte('created_at', since),
  ])

  const leads = leadsR.data || []
  const payments = (paymentsR.data || []).filter((p: any) => p.status === 'paid')
  const admissions = admissionsR.data || []
  const profiles = profilesR.data || []
  const activities = activitiesR.data || []

  // Daily trend (leads + revenue)
  const dayMap: Record<string, { date: string; leads: number; revenue: number; conversions: number }> = {}
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    dayMap[d] = { date: d, leads: 0, revenue: 0, conversions: 0 }
  }
  leads.forEach((l: any) => {
    const d = l.created_at?.slice(0, 10)
    if (dayMap[d]) {
      dayMap[d].leads++
      if (['ready_to_join', 'registered'].includes(l.status)) dayMap[d].conversions++
    }
  })
  payments.forEach((p: any) => {
    const d = (p.paid_at || p.created_at)?.slice(0, 10)
    if (dayMap[d]) dayMap[d].revenue += Number(p.amount)
  })

  // Funnel
  const funnel = {
    new: leads.filter((l: any) => l.status === 'new').length,
    contacted: leads.filter((l: any) => l.status === 'contacted').length,
    interested: leads.filter((l: any) => ['interested', 'follow_up'].includes(l.status)).length,
    ready: leads.filter((l: any) => l.status === 'ready_to_join').length,
    registered: leads.filter((l: any) => l.status === 'registered').length,
  }

  // Source breakdown
  const bySource: Record<string, number> = {}
  leads.forEach((l: any) => { bySource[l.source] = (bySource[l.source] || 0) + 1 })

  // Totals
  const totalRevenue = payments.reduce((a: number, p: any) => a + Number(p.amount), 0)
  const converted = leads.filter((l: any) => ['ready_to_join', 'registered'].includes(l.status)).length
  const convRate = leads.length ? Math.round((converted / leads.length) * 100) : 0

  return NextResponse.json({
    trend: Object.values(dayMap),
    funnel,
    bySource: Object.entries(bySource).map(([name, value]) => ({ name, value })),
    totals: {
      leads: leads.length,
      revenue: totalRevenue,
      admitted: admissions.filter((a: any) => a.status === 'admitted').length,
      conversions: converted,
      convRate,
      activities: activities.length,
      activeStaff: profiles.filter((p: any) => p.is_active && p.role !== 'student').length,
      students: profiles.filter((p: any) => p.role === 'student' && p.is_active).length,
    },
  })
}

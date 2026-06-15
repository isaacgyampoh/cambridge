import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * Course conversion analysis: for each course (and optionally a given
 * month), how many leads we received vs how many converted (registered).
 *
 * - Super admin / PM see ALL marketers' leads.
 * - A marketer sees only their OWN leads.
 *
 * Query params:
 *   month=YYYY-MM   (optional — defaults to all-time within the year)
 *   year=YYYY       (optional — defaults to current year)
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const url = new URL(req.url)
  const month = url.searchParams.get('month') // 'YYYY-MM' or null
  const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()))

  const isPrivileged = ['super_admin', 'project_manager'].includes(session.role || '')

  // Courses to report on
  const { data: courses } = await sb.from('courses')
    .select('id, name, code, is_active').eq('is_active', true).order('name')

  // Leads in scope
  let leadQ = sb.from('leads').select('id, course_interest, status, created_at, assigned_to')
  if (!isPrivileged) leadQ = leadQ.eq('assigned_to', session.userId!)
  const { data: allLeads } = await leadQ

  // Time filter
  const inScope = (l: any) => {
    if (!l.created_at) return false
    const d = l.created_at.slice(0, 7) // YYYY-MM
    if (month) return d === month
    return l.created_at.slice(0, 4) === String(year)
  }
  const leads = (allLeads || []).filter(inScope)

  const REGISTERED = ['registered']
  const CONVERTING = ['registered', 'ready_to_join'] // counted as "converting"

  function matchesCourse(ci: string, course: any): boolean {
    ci = (ci || '').toLowerCase().trim()
    if (!ci) return false
    const n = (course.name || '').toLowerCase()
    const c = (course.code || '').toLowerCase()
    return ci.includes(n) || (n && n.includes(ci)) || (c && (ci === c || ci.includes(c)))
  }

  // Per-course tally
  const byCourse = (courses || []).map((course: any) => {
    const mine = leads.filter((l: any) => matchesCourse(l.course_interest, course))
    const total = mine.length
    const registered = mine.filter((l: any) => REGISTERED.includes(l.status)).length
    const converting = mine.filter((l: any) => CONVERTING.includes(l.status)).length
    const convRate = total ? Math.round((registered / total) * 100) : 0
    return {
      id: course.id, name: course.name, code: course.code,
      leads: total, registered, converting, convRate,
    }
  }).sort((a, b) => b.leads - a.leads)

  // Uncategorised leads (no course match)
  const matchedIds = new Set<string>()
  ;(courses || []).forEach((course: any) => {
    leads.forEach((l: any) => { if (matchesCourse(l.course_interest, course)) matchedIds.add(l.id) })
  })
  const uncategorised = leads.filter((l: any) => !matchedIds.has(l.id)).length

  // Monthly breakdown across the year (for the chart)
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, '0')}`
    const monthLeads = (allLeads || []).filter((l: any) => l.created_at?.slice(0, 7) === m)
      .filter((l: any) => isPrivileged || l.assigned_to === session.userId)
    return {
      month: m,
      label: new Date(year, i, 1).toLocaleDateString('en-GH', { month: 'short' }),
      leads: monthLeads.length,
      registered: monthLeads.filter((l: any) => REGISTERED.includes(l.status)).length,
    }
  })

  // Totals
  const totalLeads = leads.length
  const totalRegistered = leads.filter((l: any) => REGISTERED.includes(l.status)).length

  return NextResponse.json({
    scope: isPrivileged ? 'all' : 'me',
    month, year,
    byCourse,
    months,
    uncategorised,
    totals: {
      leads: totalLeads,
      registered: totalRegistered,
      convRate: totalLeads ? Math.round((totalRegistered / totalLeads) * 100) : 0,
    },
  })
}

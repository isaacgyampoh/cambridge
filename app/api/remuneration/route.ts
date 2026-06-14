import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { computeRemuneration, resolveRank, nextRank, type RankBand } from '@/lib/remuneration'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const scope = url.searchParams.get('scope') || 'me'   // me | all
  const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()))
  const targetId = url.searchParams.get('marketerId') || session.userId!

  // Single marketer view
  if (scope === 'me') {
    const data = await computeRemuneration(targetId, year)
    return NextResponse.json(data)
  }

  // Admin leaderboard — all marketers ranked by points
  const isManager = ['super_admin', 'project_manager'].includes(session.role || '')
  if (!isManager) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })

  const sb = createServiceClient()
  const [profilesR, enrollR, bandsR] = await Promise.all([
    sb.from('profiles').select('id, full_name, role').eq('is_active', true).in('role', ['marketing_officer', 'project_manager']),
    sb.from('marketer_enrollments').select('marketer_id, points, registration_fee').eq('year', year),
    sb.from('rank_bands').select('*').order('sort_order', { ascending: true }),
  ])

  const bands = (bandsR.data || []) as RankBand[]
  const enrollments = enrollR.data || []

  const board = (profilesR.data || []).map((p: any) => {
    const mine = enrollments.filter((e: any) => e.marketer_id === p.id)
    const points = mine.reduce((a: number, e: any) => a + Number(e.points || 0), 0)
    const reg = mine.reduce((a: number, e: any) => a + Number(e.registration_fee || 0), 0)
    const rank = resolveRank(points, bands)
    const nxt = nextRank(rank, bands)
    return {
      id: p.id, name: p.full_name, role: p.role,
      points, enrollments: mine.length, registrationCommission: reg,
      rank: rank?.name || 'Unranked', grossSalary: rank?.gross_salary || 0,
      nextRank: nxt?.name || null, pointsToNext: nxt ? Math.max(0, nxt.min_points - points) : 0,
    }
  }).sort((a, b) => b.points - a.points)

  const totalSalaryCommitment = board.reduce((a, m) => a + m.grossSalary, 0)
  return NextResponse.json({ board, year, totalSalaryCommitment })
}

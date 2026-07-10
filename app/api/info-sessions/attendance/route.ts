import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'project_manager', 'administrator']

/**
 * PM/admin view: how many people joined each info session, broken down by the
 * marketer they came through. Optional ?session_id= to scope to one session.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sessionId = new URL(req.url).searchParams.get('session_id')
  const sb = createServiceClient()

  let q: any = sb.from('info_session_joins').select('session_id, marketer_id, marketer_code, info_sessions(title, scheduled_at)')
  if (sessionId) q = q.eq('session_id', sessionId)
  const { data: joins } = await q.limit(5000)

  // Resolve marketer names
  const ids = Array.from(new Set((joins || []).map((j: any) => j.marketer_id).filter(Boolean)))
  const nameById: Record<string, string> = {}
  if (ids.length) {
    const { data: profs } = await sb.from('profiles').select('id, full_name').in('id', ids)
    for (const p of profs || []) nameById[p.id] = p.full_name
  }

  // Group: session -> total + per-marketer counts
  const sessions: Record<string, any> = {}
  for (const j of joins || []) {
    const sid = j.session_id as string
    if (!sessions[sid]) sessions[sid] = { session_id: sid, title: (j as any).info_sessions?.title || 'Info session', scheduled_at: (j as any).info_sessions?.scheduled_at || null, total: 0, marketers: {} as Record<string, { name: string; count: number }> }
    sessions[sid].total++
    const mk = j.marketer_id || 'unattributed'
    const nm = j.marketer_id ? (nameById[j.marketer_id] || 'Unknown') : 'Not attributed'
    if (!sessions[sid].marketers[mk]) sessions[sid].marketers[mk] = { name: nm, count: 0 }
    sessions[sid].marketers[mk].count++
  }

  const result = Object.values(sessions).map((sess: any) => ({
    ...sess,
    marketers: Object.values(sess.marketers).sort((a: any, b: any) => b.count - a.count),
  })).sort((a: any, b: any) => new Date(b.scheduled_at || 0).getTime() - new Date(a.scheduled_at || 0).getTime())

  return NextResponse.json({ sessions: result })
}

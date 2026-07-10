import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/** How many people joined info sessions through THIS marketer's link. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { count } = await sb.from('info_session_joins')
    .select('id', { count: 'exact', head: true })
    .eq('marketer_id', s.userId)

  // Breakdown per session (latest few)
  const { data: joins } = await sb.from('info_session_joins')
    .select('session_id, info_sessions(title)')
    .eq('marketer_id', s.userId).limit(500)
  const bySession: Record<string, { title: string; count: number }> = {}
  for (const j of joins || []) {
    const t = (j as any).info_sessions?.title || 'Info session'
    const k = j.session_id as string
    if (!bySession[k]) bySession[k] = { title: t, count: 0 }
    bySession[k].count++
  }

  return NextResponse.json({ total: count || 0, sessions: Object.values(bySession) })
}

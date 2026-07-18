import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const ALLOWED = ['super_admin', 'project_manager']

/**
 * Preview: how many leads a session will reach + the exact message text,
 * so the PM can review before scheduling or sending.
 * Accepts the draft (title/link/description/scheduled_at/audience) so it
 * works before the session is even saved.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { title, link, description, scheduled_at, audience } = await req.json()
  const sb = createServiceClient()

  // Count the audience (with phone; email count too)
  let q: any = sb.from('leads').select('id, email', { count: 'exact' }).not('phone', 'is', null)
  if (audience === 'uncontacted') q = q.eq('status', 'new')
  else if (audience === 'interested') q = q.in('status', ['interested', 'follow_up', 'ready_to_join'])
  else q = q.not('status', 'in', '(registered,lost,not_interested)')
  const { data, count } = await q.limit(5000)
  const withEmail = (data || []).filter((l: any) => l.email).length

  const when = scheduled_at
    ? new Date(scheduled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : '[session time]'
  const sampleMsg = `Hi [name], you're invited to Cambridge Center of Excellence's "${title || '[title]'}" on ${when}.\nJoin here: ${link || '[link]'}${description ? `\n${description}` : ''}`

  return NextResponse.json({
    leadCount: count || 0,
    withEmail,
    message: sampleMsg,
  })
}

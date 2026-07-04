import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const ALLOWED = ['super_admin', 'project_manager']

// GET — list info sessions
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { data } = await sb.from('info_sessions').select('*').order('scheduled_at', { ascending: false }).limit(50)
  return NextResponse.json({ sessions: data || [] })
}

// POST — schedule a new info session
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { title, link, description, scheduled_at, notify_at, audience, channels } = await req.json()
  if (!title?.trim() || !link?.trim() || !scheduled_at || !notify_at) {
    return NextResponse.json({ error: 'Title, link, session time and send time are required.' }, { status: 400 })
  }

  const sb = createServiceClient()
  const { data, error } = await sb.from('info_sessions').insert({
    title: title.trim(), link: link.trim(), description: description?.trim() || null,
    scheduled_at, notify_at,
    audience: audience || 'all_leads',
    channels: channels || 'sms,whatsapp',
    created_by: session.userId,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ session: data })
}

// PATCH — cancel a scheduled session
export async function PATCH(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { id, action } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const sb = createServiceClient()
  if (action === 'cancel') {
    await sb.from('info_sessions').update({ status: 'cancelled' }).eq('id', id).eq('status', 'scheduled')
    return NextResponse.json({ success: true })
  }
  if (action === 'send_now') {
    const { broadcastInfoSession } = await import('@/lib/infoSessionBroadcast')
    const result = await broadcastInfoSession(id)
    if ((result as any).error) return NextResponse.json(result, { status: 400 })
    return NextResponse.json({ success: true, ...result })
  }
  return NextResponse.json({ success: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const ALLOWED = ['super_admin', 'project_manager', 'trainer']

// GET — list reminders + the batches available to schedule for
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()

  // Trainers only see their own batches; PM/admin see all active batches
  let bq: any = sb.from('batches').select('id, name, zoom_link, status').in('status', ['upcoming', 'ongoing'])
  if (session.role === 'trainer') bq = bq.eq('trainer_id', session.userId)
  const { data: batches } = await bq.order('name').limit(200)

  const { data: reminders } = await sb.from('class_reminders')
    .select('*, batch:batch_id(name)').order('class_at', { ascending: false }).limit(50)

  return NextResponse.json({ batches: batches || [], reminders: reminders || [] })
}

// POST — schedule a reminder
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { batch_id, class_at, notify_at, channels, note } = await req.json()
  if (!batch_id || !class_at || !notify_at) return NextResponse.json({ error: 'Class, class time and reminder time are required.' }, { status: 400 })

  const sb = createServiceClient()
  const { data: batch } = await sb.from('batches').select('zoom_link').eq('id', batch_id).maybeSingle()
  if (!batch?.zoom_link) return NextResponse.json({ error: 'This class has no Zoom link set. Add one on the class first.' }, { status: 400 })

  const { data, error } = await sb.from('class_reminders').insert({
    batch_id, class_at, notify_at,
    channels: channels || 'sms,whatsapp', note: note?.trim() || null,
    created_by: session.userId,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ reminder: data })
}

// PATCH — cancel or send now
export async function PATCH(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { id, action } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const sb = createServiceClient()

  if (action === 'cancel') {
    await sb.from('class_reminders').update({ status: 'cancelled' }).eq('id', id).eq('status', 'scheduled')
    return NextResponse.json({ success: true })
  }
  if (action === 'send_now') {
    const { broadcastClassReminder } = await import('@/lib/classReminderBroadcast')
    const result = await broadcastClassReminder(id)
    if ((result as any).error) return NextResponse.json(result, { status: 400 })
    return NextResponse.json({ success: true, ...result })
  }
  return NextResponse.json({ success: true })
}

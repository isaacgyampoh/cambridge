import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// GET  ?with=<userId>  -> thread with that person (and marks their msgs read)
// GET  (no param)      -> list of staff + latest message + unread counts
// POST { to, body }    -> send a message
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const me = session.userId
  const sb = createServiceClient()
  const withUser = req.nextUrl.searchParams.get('with')

  if (withUser) {
    const { data } = await sb.from('staff_messages')
      .select('id, sender_id, recipient_id, body, created_at, read_at')
      .or(`and(sender_id.eq.${me},recipient_id.eq.${withUser}),and(sender_id.eq.${withUser},recipient_id.eq.${me})`)
      .order('created_at', { ascending: true }).limit(200)
    // Mark their messages to me as read
    await sb.from('staff_messages').update({ read_at: new Date().toISOString() })
      .eq('sender_id', withUser).eq('recipient_id', me).is('read_at', null)
    return NextResponse.json({ messages: data || [] })
  }

  // Conversation list: all active staff (except me) + unread counts
  const { data: staff } = await sb.from('profiles')
    .select('id, full_name, role').eq('is_active', true).neq('id', me).order('full_name')
  const { data: unread } = await sb.from('staff_messages')
    .select('sender_id').eq('recipient_id', me).is('read_at', null).limit(1000)
  const unreadBy: Record<string, number> = {}
  for (const u of unread || []) unreadBy[u.sender_id] = (unreadBy[u.sender_id] || 0) + 1

  const list = (staff || []).map((s: any) => ({ ...s, unread: unreadBy[s.id] || 0 }))
    .sort((a: any, b: any) => b.unread - a.unread)
  const totalUnread = (unread || []).length
  return NextResponse.json({ staff: list, totalUnread })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const { to, body } = await req.json()
  if (!to || !body?.trim()) return NextResponse.json({ error: 'Missing recipient or message' }, { status: 400 })

  const sb = createServiceClient()
  const { data, error } = await sb.from('staff_messages')
    .insert({ sender_id: session.userId, recipient_id: to, body: body.trim() }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify the recipient in-app
  try {
    await sb.from('notifications').insert({
      user_id: to, type: 'message',
      title: `Message from ${session.fullName || 'a colleague'}`,
      body: body.trim().slice(0, 80),
      data: { from: session.userId },
    })
  } catch {}

  // If the recipient has been offline for 10+ minutes, email them once so
  // they know to log in. (Avoids spamming while they're actively chatting.)
  try {
    const { data: rec } = await sb.from('profiles').select('email, full_name, last_seen_at').eq('id', to).maybeSingle()
    const offlineMs = rec?.last_seen_at ? Date.now() - new Date(rec.last_seen_at).getTime() : Infinity
    if (rec?.email && offlineMs > 10 * 60 * 1000) {
      // Don't re-email if we already alerted them for an unread message in the last 30 min
      const { data: recent } = await sb.from('staff_messages')
        .select('id').eq('recipient_id', to).is('read_at', null)
        .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString()).limit(2)
      if (!recent || recent.length <= 1) {
        const { sendEmail } = await import('@/lib/integrations/email')
        const first = (rec.full_name || '').split(' ')[0] || 'there'
        await sendEmail(
          rec.email,
          `New message from ${session.fullName || 'a colleague'} — Cambridge CE`,
          `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#1a2230">
            <p style="font-size:15px;line-height:1.6">Hi ${first},</p>
            <p style="font-size:15px;line-height:1.6">You have a new message from <b>${session.fullName || 'a colleague'}</b> on the Cambridge portal.</p>
            <p style="font-size:14px;color:#5a6675;line-height:1.6">Log in to read and reply: <a href="https://portal.cambridge.edu.gh/messages" style="color:#1a7a85">portal.cambridge.edu.gh/messages</a></p>
          </div>`,
          `You have a new message from ${session.fullName || 'a colleague'} on the Cambridge portal. Log in to reply: https://portal.cambridge.edu.gh/messages`
        )
      }
    }
  } catch {}

  return NextResponse.json({ message: data })
}

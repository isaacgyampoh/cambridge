import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

/** GET — current info-session details (any staff). */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const { data } = await sb.from('settings').select('key, value')
    .in('key', ['info_session_link', 'info_session_title', 'info_session_datetime'])
  const map: any = {}
  ;(data || []).forEach((r: any) => { map[r.key] = r.value })
  return NextResponse.json({
    link: map.info_session_link || '',
    title: map.info_session_title || '',
    datetime: map.info_session_datetime || '',
  })
}

/** POST — super admin sets the link, or broadcasts it to leads.
 *  Body: { action: 'save'|'broadcast', link, title, datetime, audience }
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid || !['super_admin', 'project_manager'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const body = await req.json()
  const sb = createServiceClient()

  if (body.action === 'save') {
    await sb.from('settings').upsert([
      { key: 'info_session_link', value: body.link || '' },
      { key: 'info_session_title', value: body.title || '' },
      { key: 'info_session_datetime', value: body.datetime || '' },
    ], { onConflict: 'key' })
    return NextResponse.json({ success: true })
  }

  if (body.action === 'broadcast') {
    const link = body.link
    if (!link) return NextResponse.json({ error: 'No link to send' }, { status: 400 })

    // Audience: 'all' (every lead) or 'active' (not lost/registered)
    let q = sb.from('leads').select('id, full_name, phone, status, assigned_to')
    const { data: leads } = await q
    const audience = (leads || []).filter((l: any) => {
      if (body.audience === 'active') return !['registered', 'lost'].includes(l.status)
      return true // all
    }).filter((l: any) => l.phone)

    const when = body.datetime ? ` on ${body.datetime}` : ''
    let sent = 0
    for (const l of audience) {
      const first = (l.full_name || '').split(' ')[0] || 'there'
      const msg = `Hello ${first}, you're invited to our information session${when} at Cambridge Centre of Excellence. Join here: ${link}`
      try {
        await sendWhatsAppText(l.phone, msg, l.assigned_to || undefined)
        sent++
      } catch {
        try { await sendSMS(l.phone, msg); sent++ } catch {}
      }
    }
    return NextResponse.json({ success: true, sent, total: audience.length })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

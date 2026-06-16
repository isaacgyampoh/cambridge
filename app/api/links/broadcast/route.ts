import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

/**
 * Blast a link (e.g. info-session invite) to leads by WhatsApp (SMS fallback).
 * Body: { url, title, audience: 'active'|'all' }
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid || !['super_admin', 'project_manager'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const { url, title, audience } = await req.json()
  if (!url) return NextResponse.json({ error: 'No link to send' }, { status: 400 })

  const sb = createServiceClient()
  const { data: leads } = await sb.from('leads').select('id, full_name, phone, status, assigned_to')
  const targets = (leads || []).filter((l: any) => {
    if (audience === 'active') return !['registered', 'lost'].includes(l.status)
    return true
  }).filter((l: any) => l.phone)

  let sent = 0
  for (const l of targets) {
    const first = (l.full_name || '').split(' ')[0] || 'there'
    const msg = `Hello ${first}, ${title || 'you have an invitation'} from Cambridge Centre of Excellence. Join here: ${url}`
    try { await sendWhatsAppText(l.phone, msg, l.assigned_to || undefined); sent++ }
    catch { try { await sendSMS(l.phone, msg); sent++ } catch {} }
  }

  return NextResponse.json({ success: true, sent, total: targets.length })
}

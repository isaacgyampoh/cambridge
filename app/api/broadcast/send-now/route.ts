import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

// POST { broadcastId } — (re)send an existing broadcast that's in draft/failed
export async function POST(req: NextRequest) {
  const { broadcastId } = await req.json()
  if (!broadcastId) return NextResponse.json({ error: 'Missing broadcastId' }, { status: 400 })

  const sb = createServiceClient()
  const { data: b } = await sb.from('broadcasts').select('*').eq('id', broadcastId).maybeSingle()
  if (!b) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })

  // Get pending/failed recipients (or all if none recorded yet)
  let { data: recipients } = await sb.from('broadcast_recipients')
    .select('*').eq('broadcast_id', broadcastId)

  if (!recipients?.length) {
    return NextResponse.json({ error: 'No recipients found for this broadcast. Recreate it.' }, { status: 400 })
  }

  await sb.from('broadcasts').update({ status: 'sending' }).eq('id', broadcastId)

  const channels: string[] = b.channels || ['sms']
  let sent = 0, failed = 0

  for (const r of recipients) {
    const firstName = (r.recipient_name || '').split(' ')[0] || 'there'
    const msg = b.message.replace(/\{\{name\}\}/g, firstName)
    const phone = r.recipient_phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')

    let anyOk = false
    if (channels.includes('sms')) { try { if (await sendSMS(phone, msg)) anyOk = true } catch {} }
    if (channels.includes('whatsapp')) { try { if (await sendWhatsAppText(phone, msg)) anyOk = true } catch {} }

    if (anyOk) sent++; else failed++
    await sb.from('broadcast_recipients').update({
      status: anyOk ? 'sent' : 'failed', sent_at: anyOk ? new Date().toISOString() : null,
    }).eq('id', r.id)
  }

  await sb.from('broadcasts').update({
    status: 'sent', sent_count: sent, failed_count: failed, sent_at: new Date().toISOString(),
  }).eq('id', broadcastId)

  return NextResponse.json({ success: true, sent, failed })
}

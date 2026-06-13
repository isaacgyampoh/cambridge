import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

async function getRecipients(sb: any, target_type: string, target_filters: any) {
  let recipients: { phone: string; name: string; id: string; type: string }[] = []
  const map = (data: any[], type: string) =>
    (data || []).filter((x: any) => x.phone).map((x: any) => ({ phone: x.phone, name: x.full_name || '', id: x.id, type }))

  switch (target_type) {
    case 'all_leads': {
      const { data } = await sb.from('leads').select('id, full_name, phone').not('phone', 'is', null)
      recipients = map(data, 'lead'); break
    }
    case 'leads_by_status': {
      const { data } = await sb.from('leads').select('id, full_name, phone').eq('status', target_filters?.status || 'new').not('phone', 'is', null)
      recipients = map(data, 'lead'); break
    }
    case 'leads_by_source': {
      const { data } = await sb.from('leads').select('id, full_name, phone').eq('source', target_filters?.source || 'facebook').not('phone', 'is', null)
      recipients = map(data, 'lead'); break
    }
    case 'all_students': {
      const { data } = await sb.from('profiles').select('id, full_name, phone').eq('role', 'student').eq('is_active', true).not('phone', 'is', null)
      recipients = map(data, 'student'); break
    }
    case 'interested_not_converted': {
      const { data } = await sb.from('leads').select('id, full_name, phone').in('status', ['interested', 'follow_up']).not('phone', 'is', null)
      recipients = map(data, 'lead'); break
    }
    case 'uncontacted_leads': {
      const { data } = await sb.from('leads').select('id, full_name, phone').eq('status', 'new').is('assigned_to', null).not('phone', 'is', null)
      recipients = map(data, 'lead'); break
    }
    case 'batch_students': {
      const { data } = await sb.from('batch_students').select('student:student_id(id, full_name, phone)').eq('batch_id', target_filters?.batch_id || '')
      recipients = (data || []).map((e: any) => e.student).filter((s: any) => s?.phone).map((s: any) => ({ phone: s.phone, name: s.full_name, id: s.id, type: 'student' }))
      break
    }
  }
  return recipients
}

// POST { broadcastId } — (re)send an existing broadcast, recomputing recipients
export async function POST(req: NextRequest) {
  const { broadcastId } = await req.json()
  if (!broadcastId) return NextResponse.json({ error: 'Missing broadcastId' }, { status: 400 })

  const sb = createServiceClient()
  const { data: b } = await sb.from('broadcasts').select('*').eq('id', broadcastId).maybeSingle()
  if (!b) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })

  // Recompute recipients from the saved target_type (works for old drafts too)
  const recipients = await getRecipients(sb, b.target_type, b.target_filters)

  if (!recipients.length) {
    return NextResponse.json({
      error: `No one matches "${(b.target_type || '').replace(/_/g, ' ')}". Add leads/students with phone numbers, or pick a different audience.`,
    }, { status: 400 })
  }

  await sb.from('broadcasts').update({ status: 'sending', target_count: recipients.length }).eq('id', broadcastId)

  // Reset recipient records
  await sb.from('broadcast_recipients').delete().eq('broadcast_id', broadcastId)
  await sb.from('broadcast_recipients').insert(recipients.map(r => ({
    broadcast_id: broadcastId, recipient_phone: r.phone, recipient_name: r.name,
    recipient_type: r.type, recipient_id: r.id, status: 'pending',
  })))

  const channels: string[] = b.channels || ['sms']
  let sent = 0, failed = 0
  const sampleErrors: string[] = []

  for (const r of recipients) {
    const firstName = (r.name || '').split(' ')[0] || 'there'
    const msg = b.message.replace(/\{\{name\}\}/g, firstName)
    const phone = r.phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')

    let anyOk = false
    if (channels.includes('sms')) { try { if (await sendSMS(phone, msg)) anyOk = true; else sampleErrors.push('sms rejected') } catch (e: any) { sampleErrors.push('sms: ' + e.message) } }
    if (channels.includes('whatsapp')) { try { if (await sendWhatsAppText(phone, msg)) anyOk = true; else sampleErrors.push('whatsapp not connected') } catch (e: any) { sampleErrors.push('wa: ' + e.message) } }

    if (anyOk) sent++; else failed++
    await sb.from('broadcast_recipients').update({
      status: anyOk ? 'sent' : 'failed', sent_at: anyOk ? new Date().toISOString() : null,
    }).eq('broadcast_id', broadcastId).eq('recipient_phone', r.phone)
  }

  await sb.from('broadcasts').update({
    status: 'sent', sent_count: sent, failed_count: failed, sent_at: new Date().toISOString(),
  }).eq('id', broadcastId)

  return NextResponse.json({
    success: true, sent, failed,
    note: failed > 0 && sent === 0 ? `All failed. ${[...new Set(sampleErrors)].slice(0, 2).join('; ')}` : undefined,
  })
}

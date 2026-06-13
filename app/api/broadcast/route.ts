import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

async function getRecipients(sb: any, target_type: string, target_filters: any) {
  let recipients: { phone: string; name: string; id: string; type: string }[] = []

  switch (target_type) {
    case 'all_leads': {
      const { data } = await sb.from('leads').select('id, full_name, phone').not('phone', 'is', null)
      recipients = (data || []).map((l: any) => ({ phone: l.phone, name: l.full_name, id: l.id, type: 'lead' }))
      break
    }
    case 'leads_by_status': {
      const { data } = await sb.from('leads').select('id, full_name, phone').eq('status', target_filters.status || 'new').not('phone', 'is', null)
      recipients = (data || []).map((l: any) => ({ phone: l.phone, name: l.full_name, id: l.id, type: 'lead' }))
      break
    }
    case 'leads_by_source': {
      const { data } = await sb.from('leads').select('id, full_name, phone').eq('source', target_filters.source || 'facebook').not('phone', 'is', null)
      recipients = (data || []).map((l: any) => ({ phone: l.phone, name: l.full_name, id: l.id, type: 'lead' }))
      break
    }
    case 'all_students': {
      const { data } = await sb.from('profiles').select('id, full_name, phone').eq('role', 'student').eq('is_active', true).not('phone', 'is', null)
      recipients = (data || []).map((s: any) => ({ phone: s.phone, name: s.full_name, id: s.id, type: 'student' }))
      break
    }
    case 'batch_students': {
      const { data } = await sb.from('batch_students').select('student:student_id(id, full_name, phone)').eq('batch_id', target_filters.batch_id || '')
      recipients = (data || []).map((e: any) => e.student).filter((s: any) => s?.phone).map((s: any) => ({ phone: s.phone, name: s.full_name, id: s.id, type: 'student' }))
      break
    }
    case 'interested_not_converted': {
      const { data } = await sb.from('leads').select('id, full_name, phone').in('status', ['interested', 'follow_up']).not('phone', 'is', null)
      recipients = (data || []).map((l: any) => ({ phone: l.phone, name: l.full_name, id: l.id, type: 'lead' }))
      break
    }
    case 'uncontacted_leads': {
      const { data } = await sb.from('leads').select('id, full_name, phone').eq('status', 'new').is('assigned_to', null).not('phone', 'is', null)
      recipients = (data || []).map((l: any) => ({ phone: l.phone, name: l.full_name, id: l.id, type: 'lead' }))
      break
    }
  }
  return recipients
}

// POST /api/broadcast — send a broadcast
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { title, message, channels, target_type, target_filters, scheduled_at } = body
  const sb = createServiceClient()
  

  const recipients = await getRecipients(sb, target_type, target_filters)

  // Create broadcast record
  const { data: broadcast, error } = await sb.from('broadcasts').insert({
    title, message, channels, target_type, target_filters,
    target_count: recipients.length,
    status: scheduled_at ? 'draft' : 'sending',
    scheduled_at: scheduled_at || null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If scheduled, just save and return
  if (scheduled_at) {
    await sb.from('scheduled_tasks').insert({
      name: title,
      task_type: 'broadcast',
      payload: { broadcast_id: broadcast.id },
      run_at: scheduled_at,
      repeat_pattern: 'once',
      status: 'pending',
    })
    return NextResponse.json({ success: true, count: recipients.length, scheduled: true })
  }

  // Insert recipient records
  if (recipients.length) {
    await sb.from('broadcast_recipients').insert(
      recipients.map(r => ({
        broadcast_id: broadcast.id,
        recipient_phone: r.phone,
        recipient_name: r.name,
        recipient_type: r.type,
        recipient_id: r.id,
        status: 'pending',
      }))
    )
  }

  // Send to each recipient. Track success if ANY selected channel succeeds.
  let sent = 0
  let failed = 0

  for (const r of recipients) {
    const firstName = (r.name || '').split(' ')[0] || 'there'
    const personalizedMsg = message.replace(/\{\{name\}\}/g, firstName)
    const phone = r.phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')

    let anyOk = false
    const errors: string[] = []

    if (channels.includes('sms')) {
      try {
        const ok = await sendSMS(phone, personalizedMsg)
        if (ok) anyOk = true; else errors.push('sms failed')
      } catch (e: any) { errors.push('sms: ' + e.message) }
    }
    if (channels.includes('whatsapp')) {
      try {
        const ok = await sendWhatsAppText(phone, personalizedMsg)
        if (ok) anyOk = true; else errors.push('whatsapp failed')
      } catch (e: any) { errors.push('whatsapp: ' + e.message) }
    }

    if (anyOk) sent++; else failed++

    await sb.from('broadcast_recipients').update({
      status: anyOk ? 'sent' : 'failed',
      sent_at: anyOk ? new Date().toISOString() : null,
      error: anyOk ? null : errors.join('; ').slice(0, 300),
    }).eq('broadcast_id', broadcast.id).eq('recipient_phone', r.phone)
  }

  await sb.from('broadcasts').update({
    status: 'sent', sent_count: sent, failed_count: failed, sent_at: new Date().toISOString(),
  }).eq('id', broadcast.id)

  return NextResponse.json({ success: true, count: recipients.length, sent, failed })
}

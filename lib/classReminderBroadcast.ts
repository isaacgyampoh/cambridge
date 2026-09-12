import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { lookup } from '@/lib/db/lookup'

/**
 * Send one class reminder: the batch's Zoom link to every enrolled student
 * via SMS / WhatsApp. Shared by the cron runner and any manual send.
 */
export async function broadcastClassReminder(reminderId: string) {
  const sb = createServiceClient()
  /*
   * "Already sent" is a claim about this reminder, and a failed read cannot
   * support it. The cron runner treats that answer as final and moves on, so
   * a blip here means a class is never reminded and the reason recorded is a
   * sentence that was not true.
   */
  const { row: r, failed } = await lookup(
    sb.from('class_reminders').select('*, batch:batch_id(name, zoom_link)').eq('id', reminderId).maybeSingle(),
  )
  if (failed) {
    console.error('[classReminderBroadcast] reminder read failed:', failed)
    return { error: 'We could not read this reminder just now. Please try again in a moment.', retryable: true }
  }
  if (!r || r.status !== 'scheduled') return { error: 'Reminder not found or already sent.' }

  const batch = (r as any).batch
  if (!batch?.zoom_link) return { error: 'This class has no Zoom link set. Add one on the class first.' }

  const { data: students } = await sb.from('class_enrollments')
    .select('full_name, phone').eq('batch_id', r.batch_id).not('phone', 'is', null).limit(2000)

  const when = new Date(r.class_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  const channels = (r.channels || 'sms,whatsapp').split(',')

  let notified = 0
  for (const st of students || []) {
    const first = (st.full_name || 'there').split(' ')[0]
    const msg = `Hi ${first}, reminder: your ${batch.name} class is on ${when}.\nJoin here: ${batch.zoom_link}${r.note ? `\n${r.note}` : ''}`
    let ok = false
    try { if (channels.includes('whatsapp')) ok = await sendWhatsAppText(st.phone, msg) || ok } catch {}
    try { if (channels.includes('sms')) ok = await sendSMS(st.phone, msg) || ok } catch {}
    if (ok) notified++
  }

  await sb.from('class_reminders').update({
    status: 'sent', sent_at: new Date().toISOString(), students_notified: notified,
  }).eq('id', r.id)

  return { students_notified: notified, batch: batch.name }
}

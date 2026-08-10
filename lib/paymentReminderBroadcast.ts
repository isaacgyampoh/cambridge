import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { CONFIG } from '@/lib/config'

/**
 * Send a payment reminder to every student who currently owes a balance.
 * Personalised with their outstanding amount + a pay link. Used by the cron
 * (recurring) and manual "send now".
 */
export async function broadcastPaymentReminders(opts: { channels?: string; note?: string } = {}) {
  const sb = createServiceClient()
  const channels = (opts.channels || 'sms,whatsapp').split(',')

  // Pull the lead too, so the reminder can go out on the line the student
  // already knows — their own marketer's number, not a central one.
  const { data: fees } = await sb.from('student_fees')
    .select('student_name, phone, total_fee, amount_paid, id, lead_id')
    .limit(5000)

  const leadIds = Array.from(new Set((fees || []).map((f: any) => f.lead_id).filter(Boolean)))
  const ownerOf: Record<string, string> = {}
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data: leads } = await sb.from('leads')
      .select('id, assigned_to').in('id', leadIds.slice(i, i + 200))
    for (const l of leads || []) if (l.assigned_to) ownerOf[l.id] = l.assigned_to
  }

  const owing = (fees || [])
    .map((f: any) => ({ ...f, balance: Number(f.total_fee || 0) - Number(f.amount_paid || 0) }))
    .filter((f: any) => f.balance > 0.01 && f.phone)

  const payBase = `${CONFIG.appUrl}/pay`

  let notified = 0
  for (const f of owing) {
    const first = (f.student_name || 'there').split(' ')[0]
    const msg = `Hi ${first}, this is a friendly reminder from Cambridge Center of Excellence. You have an outstanding balance of GHS ${f.balance.toFixed(2)}.${opts.note ? `\n${opts.note}` : ''}\nTo pay: ${payBase}/${f.id}`
    // Send through their marketer's line if they have one; the sender falls
    // back to the central number when they do not.
    const owner = f.lead_id ? ownerOf[f.lead_id] || null : null
    let ok = false
    try { if (channels.includes('whatsapp')) ok = await sendWhatsAppText(f.phone, msg, owner) || ok } catch {}
    try { if (channels.includes('sms')) ok = await sendSMS(f.phone, msg) || ok } catch {}
    if (ok) notified++
  }

  return { students_notified: notified, total_owing: owing.length }
}

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

  const { data: fees } = await sb.from('student_fees')
    .select('student_name, phone, total_fee, amount_paid, id')
    .limit(5000)

  const owing = (fees || [])
    .map((f: any) => ({ ...f, balance: Number(f.total_fee || 0) - Number(f.amount_paid || 0) }))
    .filter((f: any) => f.balance > 0.01 && f.phone)

  const payBase = `${CONFIG.appUrl}/pay`

  let notified = 0
  for (const f of owing) {
    const first = (f.student_name || 'there').split(' ')[0]
    const msg = `Hi ${first}, this is a friendly reminder from Cambridge Center of Excellence. You have an outstanding balance of GHS ${f.balance.toFixed(2)}.${opts.note ? `\n${opts.note}` : ''}\nTo pay: ${payBase}/${f.id}`
    let ok = false
    try { if (channels.includes('whatsapp')) ok = await sendWhatsAppText(f.phone, msg) || ok } catch {}
    try { if (channels.includes('sms')) ok = await sendSMS(f.phone, msg) || ok } catch {}
    if (ok) notified++
  }

  return { students_notified: notified, total_owing: owing.length }
}

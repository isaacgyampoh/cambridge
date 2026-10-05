import { verifySession } from '@/lib/auth/pin'
import { isValidCronRequest } from '@/lib/auth/guard'
import { SECRETS } from '@/lib/config.server'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/integrations/sms'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { REMINDERS_KEY, remindersEnabled, DISABLED_REASON } from '@/lib/payments/reminderPolicy'

export async function POST(req: NextRequest) {
  // Payment reminders reach every student who owes money. Only finance may
  // trigger that.
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !['super_admin', 'administrator', 'accountant'].includes(s.role)) {
    return NextResponse.json({ error: 'unauth' }, { status: 401 })
  }

 if (!isValidCronRequest(req)) {
 return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 }

 const sb = createServiceClient()

 /*
  * The master switch, again. This route does NOT go through
  * broadcastPaymentReminders — it reads `invoices` rather than
  * `student_fees` and keeps its own `payment_reminders` log — so the guard
  * there does not cover it. Turning reminders off has to mean off on every
  * path that can put a message on a student's phone.
  */
 let switchRaw: string | null = null
 try {
 const { data, error } = await sb.from('settings')
 .select('value').eq('key', REMINDERS_KEY).maybeSingle()
 if (error) throw new Error(error.message)
 switchRaw = data?.value ?? null
 } catch (e: unknown) {
 const why = e instanceof Error ? e.message : String(e)
 console.error('[finance/payment-reminder] could not read', REMINDERS_KEY, '— treating as off:', why)
 return NextResponse.json({ error: DISABLED_REASON, sent: 0 }, { status: 409 })
 }
 if (!remindersEnabled(switchRaw)) {
 return NextResponse.json({ error: DISABLED_REASON, sent: 0 }, { status: 409 })
 }

 // Get all invoices with outstanding balances
 const { data: invoices } = await sb.from('invoices')
 .select('*, student:student_id(*), course:course_id(name)')
 .gt('outstanding', 0)
 .order('outstanding', { ascending: false })

 if (!invoices?.length) {
 return NextResponse.json({ message: 'No outstanding balances', count: 0 })
 }

 let sent = 0

 for (const invoice of invoices) {
 const student = (invoice as any).student
 const course = (invoice as any).course
 if (!student?.phone) continue

 const outstanding = Number(invoice.outstanding).toFixed(2)
 const paid = Number(invoice.amount_paid).toFixed(2)
 const total = Number(invoice.total_amount).toFixed(2)
 const dueDate = invoice.due_date
 ? new Date(invoice.due_date).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' })
 : 'as soon as possible'

 const smsMessage =`CCE: Hi ${student.full_name.split(' ')[0]}, your ${course?.name || 'course'} balance is GHS ${outstanding} (paid: GHS ${paid} of GHS ${total}). Please pay by ${dueDate}. Thank you!`

 const waMessage =`Hello ${student.full_name.split(' ')[0]},\n\n` +
`This is a friendly reminder from *Cambridge Center of Excellence*.\n\n` +
` Course: ${course?.name || 'Course Fee'}\n` +
` Paid: GHS ${paid}\n` +
` Outstanding: *GHS ${outstanding}*\n` +
` Due: ${dueDate}\n\n` +
`Please complete your payment to avoid any disruption to your studies.\n\n` +
`For payment options, contact us or visit our portal.\n\n` +
`Thank you!`

 try {
 // Send both SMS and WhatsApp
 await Promise.all([
 sendSMS(student.phone, smsMessage),
 sendWhatsAppText(student.phone, waMessage),
 ])

 // Log the reminder
 await sb.from('payment_reminders').insert({
 student_id: student.id,
 invoice_id: invoice.id,
 outstanding_amount: invoice.outstanding,
 reminder_type: dueDate < new Date().toISOString() ? 'overdue' : 'balance',
 sent_via: ['sms', 'whatsapp'],
 status: 'sent',
 })

 sent++
 } catch (e) {
 console.error('[PaymentReminder] Error for student', student.id, e)
 }
 }

 return NextResponse.json({ success: true, sent, total: invoices.length })
}

export async function GET(req: NextRequest) {
 if (!isValidCronRequest(req)) {
 return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 }
 return POST(new NextRequest(req.url, {
 method: 'POST',
 headers: { authorization:`Bearer ${SECRETS.cronSecret}` },
 }))
}

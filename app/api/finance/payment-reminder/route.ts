import { verifySession } from '@/lib/auth/pin'
import { isValidCronRequest } from '@/lib/auth/guard'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/integrations/sms'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { REMINDERS_KEY, remindersEnabled, DISABLED_REASON, isOverdue, formatDueDate } from '@/lib/payments/reminderPolicy'

export const runtime = 'nodejs'

/*
 * Invoice-based payment reminders.
 *
 * This route could not run. It demanded a valid finance session AND a valid
 * cron secret, and no caller can hold both: a signed-in accountant's browser
 * does not send CRON_SECRET, and the GET entry re-invoked POST with a fresh
 * NextRequest that carried the bearer token but no cookies, so the session
 * check then failed. Both verbs answered 401 for everyone. The `&&` arrived
 * with the security-hardening pass in 47a8409; it has been dead since.
 *
 * Fixed the way the rest of the codebase already does it (see
 * /api/leads/assign-unassigned): the scheduler OR a permitted person, never
 * both. Nothing is enabled by this — the master switch below still decides
 * whether anything sends, and it is off.
 */

/** Only finance may chase students for money. */
const ALLOWED = ['super_admin', 'accountant']

async function authorised(req: NextRequest): Promise<'scheduler' | 'person' | null> {
  if (isValidCronRequest(req)) return 'scheduler'
  const token = req.cookies.get('cce_session')?.value
  const s: { valid?: boolean; role?: string } = token ? await verifySession(token) : { valid: false }
  return s.valid && ALLOWED.includes(s.role || '') ? 'person' : null
}

async function sendReminders(req: NextRequest) {
  if (!await authorised(req)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()

  /*
   * The master switch. This route does NOT go through
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

  const now = Date.now()
  let sent = 0

  for (const invoice of invoices) {
    const student = (invoice as { student?: { id?: string; phone?: string; full_name?: string } }).student
    const course = (invoice as { course?: { name?: string } }).course
    if (!student?.phone) continue

    const outstanding = Number(invoice.outstanding).toFixed(2)
    const paid = Number(invoice.amount_paid).toFixed(2)
    const total = Number(invoice.total_amount).toFixed(2)
    /*
     * `overdue` was unreachable. It compared this formatted sentence against
     * an ISO timestamp as strings — "5 October 2026" < "2026-10-06T…" is a
     * character comparison that is false for every date, and false for
     * "as soon as possible" too, so every reminder was logged as 'balance'.
     * The real date decides it now, and a missing one is not overdue.
     */
    const overdue = isOverdue(invoice.due_date, now)
    const dueDate = formatDueDate(invoice.due_date)

    const smsMessage = `CCE: Hi ${student.full_name?.split(' ')[0]}, your ${course?.name || 'course'} balance is GHS ${outstanding} (paid: GHS ${paid} of GHS ${total}). Please pay by ${dueDate}. Thank you!`

    const waMessage = `Hello ${student.full_name?.split(' ')[0]},\n\n` +
`This is a friendly reminder from *Cambridge Center of Excellence*.\n\n` +
` Course: ${course?.name || 'Course Fee'}\n` +
` Paid: GHS ${paid}\n` +
` Outstanding: *GHS ${outstanding}*\n` +
` Due: ${dueDate}\n\n` +
`Please complete your payment to avoid any disruption to your studies.\n\n` +
`For payment options, contact us or visit our portal.\n\n` +
`Thank you!`

    /*
     * allSettled, not all. With Promise.all a failing SMS threw away the
     * WhatsApp result, so a student who HAD been messaged was neither counted
     * nor logged — and the next run would message them again. Each channel is
     * now judged on its own, and one delivery is enough to count.
     */
    const [smsResult, waResult] = await Promise.allSettled([
      sendSMS(student.phone, smsMessage),
      sendWhatsAppText(student.phone, waMessage),
    ])
    const smsOk = smsResult.status === 'fulfilled' && smsResult.value !== false
    const waOk = waResult.status === 'fulfilled' && waResult.value !== false
    if (smsResult.status === 'rejected') console.error('[PaymentReminder] SMS failed for', student.id, smsResult.reason)
    if (waResult.status === 'rejected') console.error('[PaymentReminder] WhatsApp failed for', student.id, waResult.reason)

    if (!smsOk && !waOk) continue

    const via = [smsOk && 'sms', waOk && 'whatsapp'].filter(Boolean)
    // Log the reminder. A failed log must not lose a delivery that happened.
    const { error: logError } = await sb.from('payment_reminders').insert({
      student_id: student.id,
      invoice_id: invoice.id,
      outstanding_amount: invoice.outstanding,
      reminder_type: overdue ? 'overdue' : 'balance',
      sent_via: via,
      status: 'sent',
    })
    if (logError) console.error('[PaymentReminder] sent but not logged for', student.id, logError.message)

    sent++
  }

  return NextResponse.json({ success: true, sent, total: invoices.length })
}

export async function POST(req: NextRequest) { return sendReminders(req) }
export async function GET(req: NextRequest) { return sendReminders(req) }

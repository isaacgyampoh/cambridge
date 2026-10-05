import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { broadcastPaymentReminders } from '@/lib/paymentReminderBroadcast'

export const runtime = 'nodejs'

/**
 * The daily cron entry for fee reminders.
 *
 * The comment that used to sit here said this was "NOT wired to auto-run by
 * default". That was untrue: `payment_reminders` is in the TASKS list in
 * /api/cron/run on a 1440-minute interval and has been firing daily, sending
 * to every student who owes. Isaac asked for that to stop.
 *
 * The task deliberately stays in the list. It now reads the
 * payment_reminders_enabled switch through broadcastPaymentReminders and does
 * nothing while that is off, so turning it back on is one toggle rather than
 * a code change — and the automation page keeps showing when it last ran and
 * that it is off on purpose.
 */
export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await broadcastPaymentReminders({})
  // The detail string lands in cron_runs.last_detail, which the automation
  // page shows — so "off" is visible there instead of a silent zero.
  return NextResponse.json({ ran: true, ...result })
}

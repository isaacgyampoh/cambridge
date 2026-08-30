import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { broadcastPaymentReminders } from '@/lib/paymentReminderBroadcast'
import { SECRETS } from '@/lib/config.server'

export const runtime = 'nodejs'

/**
 * Manual/optional cron for payment reminders. Because this sends to everyone
 * owing, it is NOT wired to auto-run by default — trigger it deliberately
 * (from the finance page "Send reminders" button) or point a WEEKLY cron at
 * it: /api/payment-reminders/run?key=SETUP_SECRET
 */
export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get('key')
  if (!isValidCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await broadcastPaymentReminders({})
  return NextResponse.json({ ran: true, ...result })
}

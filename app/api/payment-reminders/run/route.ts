import { NextRequest, NextResponse } from 'next/server'
import { broadcastPaymentReminders } from '@/lib/paymentReminderBroadcast'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/**
 * Manual/optional cron for payment reminders. Because this sends to everyone
 * owing, it is NOT wired to auto-run by default — trigger it deliberately
 * (from the finance page "Send reminders" button) or point a WEEKLY cron at
 * it: /api/payment-reminders/run?key=SETUP_SECRET
 */
export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get('key')
  if (key !== CONFIG.setupSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await broadcastPaymentReminders({})
  return NextResponse.json({ ran: true, ...result })
}

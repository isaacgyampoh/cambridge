import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { broadcastPaymentReminders } from '@/lib/paymentReminderBroadcast'

export const runtime = 'nodejs'

const ALLOWED = ['super_admin', 'accountant']

/** Finance-triggered: send reminders to everyone owing, right now. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const result = await broadcastPaymentReminders({ channels: body.channels, note: body.note })
  /*
   * A skip is not a success. Spreading the result into { success: true } made
   * the switch being off look like "sent to 0 of 0 students", which reads as
   * "nobody owes anything" — the opposite of what happened.
   */
  if ('skipped' in result && result.skipped) {
    return NextResponse.json({ error: result.skipped, ...result }, { status: 409 })
  }
  return NextResponse.json({ success: true, ...result })
}

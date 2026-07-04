import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { broadcastPaymentReminders } from '@/lib/paymentReminderBroadcast'

export const runtime = 'nodejs'

const ALLOWED = ['super_admin', 'project_manager', 'accountant']

/** Finance-triggered: send reminders to everyone owing, right now. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const result = await broadcastPaymentReminders({ channels: body.channels, note: body.note })
  return NextResponse.json({ success: true, ...result })
}

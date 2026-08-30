import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { runClassStartReminders } from '@/lib/student/classReminder'
import { SECRETS } from '@/lib/config.server'

export const runtime = 'nodejs'

/** Cron (every 10 min): /api/classes/start-reminders?key=SECRET */
export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const r = await runClassStartReminders()
  return NextResponse.json({ ran: true, ...r })
}

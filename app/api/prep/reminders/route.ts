import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { runPrepReminders } from '@/lib/prepReminders'

export const runtime = 'nodejs'

/** Cron (daily): /api/prep/reminders?key=SECRET */
export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runPrepReminders()
  return NextResponse.json({ ran: true, ...result })
}

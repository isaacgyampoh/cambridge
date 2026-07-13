import { NextRequest, NextResponse } from 'next/server'
import { runPrepReminders } from '@/lib/prepReminders'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/** Cron (daily): /api/prep/reminders?key=SECRET */
export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.get('key') !== CONFIG.setupSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runPrepReminders()
  return NextResponse.json({ ran: true, ...result })
}

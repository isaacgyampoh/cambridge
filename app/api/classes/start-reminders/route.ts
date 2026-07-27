import { NextRequest, NextResponse } from 'next/server'
import { runClassStartReminders } from '@/lib/student/classReminder'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/** Cron (every 10 min): /api/classes/start-reminders?key=SECRET */
export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.get('key') !== CONFIG.setupSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const r = await runClassStartReminders()
  return NextResponse.json({ ran: true, ...r })
}

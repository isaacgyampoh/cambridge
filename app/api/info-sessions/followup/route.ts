import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { runInfoSessionFollowups } from '@/lib/infoSessionFollowup'

export const runtime = 'nodejs'

/** Cron (every ~30 min): /api/info-sessions/followup?key=SECRET */
export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runInfoSessionFollowups()
  return NextResponse.json({ ran: true, ...result })
}

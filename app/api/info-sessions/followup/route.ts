import { NextRequest, NextResponse } from 'next/server'
import { runInfoSessionFollowups } from '@/lib/infoSessionFollowup'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/** Cron (every ~30 min): /api/info-sessions/followup?key=SECRET */
export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.get('key') !== CONFIG.setupSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runInfoSessionFollowups()
  return NextResponse.json({ ran: true, ...result })
}

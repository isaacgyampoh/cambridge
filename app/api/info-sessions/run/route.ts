import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { broadcastInfoSession } from '@/lib/infoSessionBroadcast'

export const runtime = 'nodejs'

/**
 * Info-session auto-broadcast runner. Hit by the free external cron
 * (cron-job.org) every ~15 min: /api/info-sessions/run?key=SETUP_SECRET
 * Sends every scheduled session whose notify_at has passed.
 */
export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get('key')
  if (!isValidCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const now = new Date().toISOString()
  const { data: due } = await sb.from('info_sessions')
    .select('id').eq('status', 'scheduled').lte('notify_at', now).limit(5)

  const results = []
  for (const s of due || []) {
    results.push(await broadcastInfoSession(s.id))
  }
  return NextResponse.json({ ran: true, sessions: results.length, results })
}

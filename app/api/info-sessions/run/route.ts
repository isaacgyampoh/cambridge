import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { advanceCampaign, enrolRecipients } from '@/lib/infoSessionCampaign'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * The older cron path, kept because an external schedule still points at it.
 *
 * It does what the worker's sweep does, by calling the same functions —
 * starting any scheduled campaign whose time has come and resuming any that
 * stopped part way. A second implementation of "send a campaign" is exactly
 * how the scheduled path and the manual one came to behave differently.
 */
export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const { data: due } = await sb.from('info_sessions')
    .select('id, audience, status')
    .in('status', ['sending', 'scheduled'])
    .lte('notify_at', new Date().toISOString())
    .limit(10)

  const results: Array<Record<string, unknown>> = []
  for (const s of due || []) {
    if (s.status === 'scheduled') {
      const enrolled = await enrolRecipients(s.id, s.audience || 'all_leads')
      if (typeof enrolled !== 'number') { results.push({ id: s.id, ...enrolled }); continue }
      await sb.from('info_sessions').update({ status: 'sending' }).eq('id', s.id).eq('status', 'scheduled')
    }
    results.push({ id: s.id, ...(await advanceCampaign(s.id, 0)) })
  }

  return NextResponse.json({ ran: true, sessions: results.length, results })
}

import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { advanceCampaign, enrolRecipients } from '@/lib/infoSessionCampaign'
import { tableExists } from '@/lib/db/hasColumn'

export const runtime = 'nodejs'

/**
 * One hop of a campaign.
 *
 * ── WHO CALLS THIS ─────────────────────────────────────────────────────────
 *
 *   the Send request   fires the first hop and returns without waiting
 *   this endpoint      fires the next one before it returns
 *   the dispatcher     sweeps for anything unfinished, every run
 *
 * The chain is what makes a campaign prompt; the dispatcher is what makes it
 * certain. Neither needs a browser to be open, and neither keeps anything in
 * memory between invocations, because on this platform nothing can.
 *
 * Authenticated with the cron secret: every caller is the server itself.
 */
export const maxDuration = 60

async function handle(req: NextRequest) {
  if (!isValidCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const sessionId = url.searchParams.get('session')
  const hop = Number(url.searchParams.get('hop') || '0') || 0

  if (!(await tableExists('info_session_recipients'))) {
    return NextResponse.json({
      ran: false,
      error: 'Migration 0029 has not been run, so campaigns cannot be tracked.',
    }, { status: 503 })
  }

  if (sessionId) {
    const result = await advanceCampaign(sessionId, hop)
    if ('error' in result) return NextResponse.json({ ran: false, ...result }, { status: 503 })
    return NextResponse.json({ ran: true, hop, ...result })
  }

  /*
   * No session named: the recovery sweep.
   *
   * Everything still `sending`, plus anything whose notify_at has passed and
   * is still `scheduled` — which is how a scheduled campaign starts without
   * anybody pressing anything.
   */
  const sb = createServiceClient()
  const now = new Date().toISOString()

  const { data: due } = await sb.from('info_sessions')
    .select('id, audience, status')
    .in('status', ['sending', 'scheduled'])
    .lte('notify_at', now)
    .limit(10)

  const results: Array<Record<string, unknown>> = []
  for (const s of due || []) {
    /*
     * A scheduled campaign is enrolled and switched to `sending` here, by the
     * same path the Send button uses. Two sending routines, one for scheduled
     * and one for immediate, is how the two come to behave differently.
     */
    if (s.status === 'scheduled') {
      const enrolled = await enrolRecipients(s.id, s.audience || 'all_leads')
      if (typeof enrolled !== 'number') { results.push({ id: s.id, ...enrolled }); continue }
      await sb.from('info_sessions').update({ status: 'sending' }).eq('id', s.id).eq('status', 'scheduled')
    }
    const r = await advanceCampaign(s.id, 0)
    results.push({ id: s.id, ...r })
  }

  return NextResponse.json({ ran: true, swept: results.length, results })
}

export const GET = handle
export const POST = handle

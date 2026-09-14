import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireSession, GuardError } from '@/lib/auth/guard'
import { lookup } from '@/lib/db/lookup'
import { visitsForCode } from '@/lib/marketing/visits'

export const runtime = 'nodejs'

/**
 * How MY marketing link is doing.
 *
 * ── SCOPE ──────────────────────────────────────────────────────────────────
 *
 * Strictly the signed-in person's own. The code is read from their profile
 * rather than taken from the request, so there is no parameter to change: a
 * marketer cannot ask this endpoint about a colleague's link, because there
 * is nowhere to put a colleague's code.
 *
 * Counts only — never the leads themselves. A marketer already has a screen
 * that lists their leads, with the existing row scoping applied; duplicating
 * that here would be a second way to read people, and a second place to get
 * the scoping wrong.
 */
export async function GET(req: NextRequest) {
  let ctx
  try { ctx = await requireSession(req) } catch (e) { return (e as GuardError).response }

  const sb = createServiceClient()

  const { row: me, failed } = await lookup(
    sb.from('profiles').select('marketer_code').eq('id', ctx.session.userId!).maybeSingle(),
  )
  if (failed) {
    console.error('[marketing/me] profile read failed:', failed)
    return NextResponse.json(
      { error: 'We could not load your marketing figures just now. Please try again in a moment.' },
      { status: 503 },
    )
  }

  const code = (me?.marketer_code as string | null) || null
  if (!code) {
    // They have not generated a link yet. Not an error — the screen offers to.
    return NextResponse.json({ code: null })
  }

  const visits = await visitsForCode(code)

  /*
   * Leads and registrations that came from THIS link.
   *
   * utm_content carries the code, set by registerHref — which is what tells a
   * registration that arrived through /m apart from one through the same
   * person's ordinary /apply link. Counting every lead assigned to them would
   * answer a different question, and a flattering one.
   */
  const { count: leads } = await sb.from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('utm_content', code)
    .eq('utm_source', 'marketing_link')

  const { count: registrations } = await sb.from('applications')
    .select('id', { count: 'exact', head: true })
    .eq('marketer_id', ctx.session.userId!)
    .eq('payment_status', 'paid')

  return NextResponse.json({
    code,
    visits,
    leads: leads ?? 0,
    registrations: registrations ?? 0,
  })
}

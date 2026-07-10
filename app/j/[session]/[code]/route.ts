import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Tracked info-session join link: /j/{sessionId}/{marketerCode}?p={phone}
 * Records who the person came through, then 302-redirects to the real Zoom
 * link. The underlying Zoom link is never changed — this just attributes the
 * click and forwards.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ session: string; code: string }> }) {
  const { session, code } = await ctx.params
  const phone = new URL(req.url).searchParams.get('p') || null

  const sb = createServiceClient()
  const { data: s } = await sb.from('info_sessions').select('id, link').eq('id', session).maybeSingle()
  // If the session/link is missing, send them somewhere safe.
  const target = s?.link || 'https://cambridge.edu.gh'

  try {
    // Resolve the marketer from their code
    let marketerId: string | null = null
    if (code && code !== 'x') {
      const { data: m } = await sb.from('profiles').select('id').eq('marketer_code', code).maybeSingle()
      marketerId = m?.id || null
    }
    // Try to tie it to an existing lead by phone
    let leadId: string | null = null
    if (phone) {
      const { data: l } = await sb.from('leads').select('id').eq('phone', phone).maybeSingle()
      leadId = l?.id || null
    }
    // Record the join (de-dupe: same session+phone within this session)
    if (s?.id) {
      await sb.from('info_session_joins').insert({
        session_id: s.id, marketer_id: marketerId, marketer_code: code || null,
        lead_id: leadId, phone,
      })
    }
  } catch { /* never block the redirect on a tracking error */ }

  return NextResponse.redirect(target, { status: 302 })
}

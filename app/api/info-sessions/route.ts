import { NextRequest, NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { saveFailed, lookup, unavailable } from '@/lib/db/lookup'

export const runtime = 'nodejs'

/**
 * Info sessions — the Information section.
 *
 * ── WHY THIS IS GUARDED BY A PORTAL AND NOT A ROLE LIST ────────────────────
 *
 * It was `ALLOWED = ['super_admin', 'project_manager']`, checked by role, and
 * that is the whole reason the Admissions team reported that nothing sends.
 *
 * Three other layers already say who may be here, and all three agree with
 * each other and disagreed with this one:
 *
 *   lib/access/portals.ts   grants the PAGE /pm/info-sessions to grp_automation
 *   lib/access/apiAccess.ts grants THIS PATH to grp_automation
 *   the sidebar             shows "Automation → Info sessions" for it
 *
 * So an admissions officer granted that portal saw the section, opened it,
 * filled it in, chose SMS, pressed send — and got 401. The list came back
 * empty for the same reason, so the section also looked like it had never
 * been used. The only visible symptom was a toast reading "unauth".
 *
 * Guarded by the portal now, which is the same answer the other three give.
 * A grant means something or it does not.
 */

const PORTALS = ['grp_automation']

export const GET = withGuard({ portals: PORTALS }, async () => {
  const sb = createServiceClient()
  const { row: sessions, failed } = await lookup(
    sb.from('info_sessions').select('*').order('scheduled_at', { ascending: false }).limit(50),
  )
  // An empty list because the read failed is not an empty list.
  if (failed) return unavailable('[info-sessions]', failed, 'the information sessions')
  return NextResponse.json({ sessions: sessions || [] })
})

export const POST = withGuard({ portals: PORTALS }, async (req: NextRequest, { session }) => {
  const { title, link, description, scheduled_at, notify_at, audience, channels } = await req.json()
  if (!title?.trim() || !link?.trim() || !scheduled_at || !notify_at) {
    return NextResponse.json({ error: 'Title, link, session time and send time are required.' }, { status: 400 })
  }

  /*
   * A session with no channel can never be sent, and the form lets every
   * channel be switched off. Refused here rather than saved as something
   * that will sit scheduled for ever and send nothing.
   */
  const picked = String(channels || '').split(',').map(c => c.trim()).filter(Boolean)
  if (!picked.length) {
    return NextResponse.json(
      { error: 'Choose at least one way to send it — SMS, WhatsApp or email.' }, { status: 400 })
  }

  const sb = createServiceClient()
  const { data, error } = await sb.from('info_sessions').insert({
    title: title.trim(), link: link.trim(), description: description?.trim() || null,
    scheduled_at, notify_at,
    audience: audience || 'all_leads',
    channels: picked.join(','),
    created_by: session.userId,
  }).select().single()
  if (error) return saveFailed('[info-sessions]', error.message, 'that session')
  return NextResponse.json({ session: data })
})

export const PATCH = withGuard({ portals: PORTALS }, async (req: NextRequest) => {
  const { id, action } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const sb = createServiceClient()

  if (action === 'cancel') {
    await sb.from('info_sessions').update({ status: 'cancelled' }).eq('id', id).eq('status', 'scheduled')
    return NextResponse.json({ success: true })
  }

  if (action === 'send_now') {
    const { broadcastInfoSession } = await import('@/lib/infoSessionBroadcast')
    const result = await broadcastInfoSession(id)
    if ('error' in result && result.error) return NextResponse.json(result, { status: 400 })
    return NextResponse.json({ success: true, ...result })
  }

  return NextResponse.json({ success: true })
})

/*
 * Sending reaches out to every targeted lead. The platform default is ten to
 * fifteen seconds, which a few dozen recipients exceed — and a request killed
 * half way through has sent some of them.
 */
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { SECRETS } from '@/lib/config.server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { lookup, unavailable, saveFailed } from '@/lib/db/lookup'

/**
 * Save / update a person's own WhatsApp (WaSender) session credentials.
 * Each marketer connects their own WhatsApp line so messages to their
 * leads come from their number and replies land on their phone.
 *
 * Admin can set this for anyone (pass staffId); a user can set their own.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { staffId, apiKey, number, status } = await req.json()

  // Only super_admin / project_manager can set for others
  const target = staffId && staffId !== session.userId ? staffId : session.userId
  if (target !== session.userId && !['super_admin', 'project_manager'].includes(session.role || '')) {
    return NextResponse.json({ error: 'You can only manage your own WhatsApp line.' }, { status: 403 })
  }

  const sb = createServiceClient()
  const update: any = {}
  if (apiKey !== undefined && apiKey !== '') update.wasender_api_key = apiKey
  if (number !== undefined) update.wasender_phone = number || null
  if (status !== undefined) update.wasender_status = status

  const { error } = await sb.from('profiles').update(update).eq('id', target)
  if (error) return saveFailed('[whatsapp/instance]', error.message, 'that connection')
  return NextResponse.json({ success: true })
}

/**
 * Test a connection by sending a message to the person's own number.
 */
export async function PUT(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  /*
   * ── THE SAME GUARD POST HAS, WHICH THIS DID NOT ──────────────────────────
   *
   * `target` was `staffId || session.userId` with nothing checking it, so a
   * client-supplied id was simply obeyed. Any signed-in member of staff could
   * name a colleague and:
   *
   *   - send a WhatsApp message through THAT person's WaSender key, from
   *     their line and against their account;
   *   - read the provider's raw response for a key that is not theirs;
   *   - and, because the write at the end of this handler is keyed on the
   *     same `target`, set that colleague's wasender_status to
   *     'disconnected' — quietly stopping their leads being messaged.
   *
   * POST has guarded exactly this since it was written. PUT is the same
   * decision about the same column, so it gets the same rule.
   */
  const { staffId } = await req.json()
  const target = staffId && staffId !== session.userId ? staffId : session.userId
  if (target !== session.userId && !['super_admin', 'project_manager'].includes(session.role || '')) {
    return NextResponse.json({ error: 'You can only test your own WhatsApp line.' }, { status: 403 })
  }

  const sb = createServiceClient()
  const { row: p, failed } = await lookup(
    sb.from('profiles')
      .select('wasender_api_key, phone, wasender_phone, full_name')
      .eq('id', target).maybeSingle(),
  )

  if (failed) return unavailable('[whatsapp/instance]', failed, 'that connection')
  if (!p?.wasender_api_key) {
    return NextResponse.json({ error: 'No WaSender API key set for this person yet.' }, { status: 400 })
  }

  const testTo = p.wasender_phone || p.phone
  if (!testTo) return NextResponse.json({ error: 'No phone number to test with.' }, { status: 400 })

  const phone = String(testTo).replace(/[^0-9+]/g, '').replace(/^\+/, '').replace(/^0/, '233')
  let ok = false, resp: any = null
  try {
    const res = await fetch(SECRETS.wasenderUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.wasender_api_key}` },
      body: JSON.stringify({
        to: phone,
        text: `Cambridge CCE: your WhatsApp line is now connected to the system, ${p.full_name?.split(' ')[0] || ''}. Messages to your leads will come from this number.`,
      }),
      signal: AbortSignal.timeout(15000),
    })
    resp = await res.json().catch(() => ({}))
    ok = res.ok && resp?.success !== false
  } catch (e: any) {
    // The cause goes to the log, not to the browser: a fetch failure message
    // can carry the full request URL, and this one is built with the key.
    console.error('[whatsapp/instance] test send failed:', e?.message)
    resp = { error: 'The test message could not be sent. Check the API key and the number.' }
  }

  await sb.from('profiles').update({ wasender_status: ok ? 'connected' : 'disconnected' }).eq('id', target)

  return NextResponse.json({ success: ok, response: resp })
}

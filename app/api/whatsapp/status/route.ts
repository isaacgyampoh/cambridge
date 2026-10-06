import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { SECRETS } from '@/lib/config.server'
import { recordAudit } from '@/lib/audit'
import { normaliseWasenderKey, describeSessionStatus, keyFingerprint } from '@/lib/whatsapp/wasenderRules'
import { sessionStatus, checkContact, sendText, credentialFor, recordLineStatus } from '@/lib/whatsapp/wasender'
import { runQuietly } from '@/lib/quiet'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager']

/**
 * GET  — the REAL status of every WhatsApp line, read from WasenderAPI now.
 * POST { phone, action: 'check' | 'send', staffId? }
 *        check: is this number on WhatsApp?  (GET /api/on-whatsapp/{number})
 *        send:  send a real test message     (POST /api/send-message)
 *
 * ── WHAT CHANGED ───────────────────────────────────────────────────────────
 *
 * GET never contacted WasenderAPI. It reported whether a key string was
 * present and whatever status had last been written to the database — which
 * for a newly saved line was the 'connecting' the screen itself wrote — and
 * it returned the first six and last four characters of the key. It now asks
 * WasenderAPI for each line and returns only a masked fingerprint.
 *
 * POST always used the central WASENDER_API_KEY from the server environment,
 * even though the key an administrator enters in the portal is saved on the
 * line. So a correct key entered in the portal was never the one tested, and
 * an old environment key produced "invalid API key". The line to test is now
 * chosen explicitly, and the response names which credential was used.
 */

async function guard(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: { valid?: boolean; role?: string; userId?: string } = token ? await verifySession(token) : { valid: false }
  return s.valid && ALLOWED.includes(s.role || '') ? s : null
}

function describe(result: Awaited<ReturnType<typeof sessionStatus>>) {
  if (result.ok) {
    const d = describeSessionStatus(result.status)
    return { status: result.status, label: d.label, tone: d.tone, message: d.action, kind: null }
  }
  return { status: null, label: 'Not working', tone: 'danger' as const, message: result.message, kind: result.kind }
}

export async function GET(req: NextRequest) {
  if (!await guard(req)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const centralKey = normaliseWasenderKey(SECRETS.wasenderApiKey)
  const sb = createServiceClient()
  const { data: lines, error } = await sb.from('profiles')
    .select('id, full_name, wasender_phone, wasender_api_key')
    .not('wasender_api_key', 'is', null).limit(50)
  if (error) return NextResponse.json({ error: 'The WhatsApp lines could not be loaded just now.' }, { status: 503 })

  // Every line checked at once, each against its own key.
  const [central, ...perLine] = await Promise.all([
    centralKey ? sessionStatus(centralKey) : Promise.resolve(null),
    ...(lines || []).map(l => sessionStatus(normaliseWasenderKey(l.wasender_api_key as string))),
  ])

  /*
   * Recording the status is bookkeeping. allSettled, because a single failed
   * write must not cost the operator the page that tells them which line is
   * down — that is exactly when they need to look at it.
   */
  await runQuietly('[whatsapp/status] recording line status',
    (lines || []).map((l, i) => () => recordLineStatus(l.id as string, perLine[i])))

  return NextResponse.json({
    central: centralKey
      ? { configured: true, key: keyFingerprint(centralKey), ...describe(central!) }
      : { configured: false, key: null, status: null, label: 'Not set', tone: 'muted',
          message: 'No central WASENDER_API_KEY is set on the server. Lines with their own key still work.', kind: 'missing_key' },
    lines: (lines || []).map((l, i) => ({
      id: l.id,
      name: l.full_name,
      number: l.wasender_phone,
      key: keyFingerprint(normaliseWasenderKey(l.wasender_api_key as string)),
      ...describe(perLine[i]),
    })),
    checkedAt: new Date().toISOString(),
  })
}

const Body = z.object({
  phone: z.string().trim().min(6, 'Enter a phone number.').max(40),
  action: z.enum(['check', 'send']).default('check'),
  staffId: z.string().uuid().optional().nullable(),
})

export async function POST(req: NextRequest) {
  const s = await guard(req)
  if (!s) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request.' }, { status: 400 })
  const { phone, action, staffId } = parsed.data

  const cred = await credentialFor(staffId || null)
  if ('error' in cred) return NextResponse.json({ ok: false, error: cred.error }, { status: 400 })
  const via = cred.source === 'line' ? 'this line’s own key' : 'the central server key'

  if (action === 'check') {
    const r = await checkContact(cred.key, phone)
    if (!r.ok) return NextResponse.json({ ok: false, kind: r.kind, error: r.message, http: r.http, via })
    return NextResponse.json({
      ok: true, number: r.number, exists: r.exists, via,
      message: r.exists
        ? `+${r.number} is on WhatsApp. The key works and WasenderAPI answered.`
        : `+${r.number} is not on WhatsApp. (The key works — WasenderAPI answered the check.)`,
    })
  }

  const started = new Date().toISOString()
  const r = await sendText(cred.key, phone,
    'Cambridge Centre of Excellence — this is a test message confirming WhatsApp is connected to the portal.')

  // A record of the test: endpoint, result, provider id and time. Not the key.
  const sb = createServiceClient()
  await sb.from('whatsapp_logs').insert({
    recipient: r.number,
    message: '[connection test]',
    status: r.ok ? 'sent' : 'failed',
    provider_response: r.ok
      ? { endpoint: '/api/send-message', http: r.http, messageId: r.messageId, via: cred.source }
      : { endpoint: '/api/send-message', http: r.http, kind: r.kind, via: cred.source },
  }).then(() => {}, () => {})

  await recordAudit({
    actorId: s.userId, action: 'whatsapp.test_message', resource: 'profiles',
    resourceId: cred.profileId ?? undefined, success: r.ok,
    metadata: { started, endpoint: '/api/send-message', http: r.http, via: cred.source,
      messageId: r.ok ? r.messageId : null, kind: r.ok ? null : r.kind },
  })

  if (!r.ok) {
    // A send refused for authentication or a dead session says something true
    // about the line; a bad recipient does not.
    if (cred.profileId && (r.kind === 'auth' || r.kind === 'session_not_connected')) {
      await recordLineStatus(cred.profileId, await sessionStatus(cred.key))
    }
    return NextResponse.json({ ok: false, kind: r.kind, error: r.message, http: r.http, via })
  }
  return NextResponse.json({
    ok: true, number: r.number, messageId: r.messageId, http: r.http, via,
    message: `Test message accepted by WasenderAPI for +${r.number}${r.messageId ? ` (message id ${r.messageId})` : ''}.`,
  })
}

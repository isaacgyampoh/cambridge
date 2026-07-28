import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager']

/**
 * GET  — is WaSender configured, and which lines are connected?
 * POST { phone } — send a real test message and return WaSender's own reply,
 *                  so a failure shows the actual reason instead of just false.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const key = CONFIG.wasenderApiKey || ''
  const sb = createServiceClient()
  const { data: lines } = await sb.from('profiles')
    .select('full_name, wasender_phone, wasender_status')
    .not('wasender_api_key', 'is', null).limit(50)

  return NextResponse.json({
    central_key_set: !!key,
    central_key_fingerprint: key ? `${key.slice(0, 6)}…${key.slice(-4)}` : null,
    endpoint: CONFIG.wasenderUrl,
    staff_lines: (lines || []).map((l: any) => ({
      name: l.full_name, number: l.wasender_phone, status: l.wasender_status || 'not tested',
    })),
    diagnosis: !key
      ? 'WASENDER_API_KEY is not reaching the server. Add it in Vercel and redeploy.'
      : 'Central WaSender key is set. Use the test below to confirm messages actually send.',
  })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { phone } = await req.json().catch(() => ({}))
  if (!phone) return NextResponse.json({ error: 'Enter a phone number to test.' }, { status: 400 })

  const key = CONFIG.wasenderApiKey
  if (!key) return NextResponse.json({ error: 'WASENDER_API_KEY is not set on the server.' }, { status: 500 })

  const to = '+' + String(phone).replace(/\s+/g, '').replace(/^\+/, '').replace(/^0/, '233')
  try {
    const res = await fetch(CONFIG.wasenderUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ to, text: 'Cambridge Center of Excellence — WhatsApp is connected and working.' }),
      signal: AbortSignal.timeout(15000),
    })
    const body = await res.json().catch(() => ({}))
    return NextResponse.json({
      sent: res.ok && body?.success !== false,
      to,
      http_status: res.status,
      provider_response: body,
    })
  } catch (e: any) {
    return NextResponse.json({ sent: false, to, error: e?.message || 'Could not reach WaSender.' }, { status: 500 })
  }
}

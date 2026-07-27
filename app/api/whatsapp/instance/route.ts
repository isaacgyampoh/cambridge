import { NextRequest, NextResponse } from 'next/server'
import { CONFIG } from '@/lib/config'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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

  const { staffId } = await req.json()
  const target = staffId || session.userId

  const sb = createServiceClient()
  const { data: p } = await sb.from('profiles')
    .select('wasender_api_key, phone, wasender_phone, full_name')
    .eq('id', target).maybeSingle()

  if (!p?.wasender_api_key) {
    return NextResponse.json({ error: 'No WaSender API key set for this person yet.' }, { status: 400 })
  }

  const testTo = p.wasender_phone || p.phone
  if (!testTo) return NextResponse.json({ error: 'No phone number to test with.' }, { status: 400 })

  const phone = '+' + String(testTo).replace(/\s+/g, '').replace(/^\+/, '').replace(/^0/, '233')
  let ok = false, resp: any = null
  try {
    const res = await fetch(CONFIG.wasenderUrl, {
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
    resp = { error: e.message }
  }

  await sb.from('profiles').update({ wasender_status: ok ? 'connected' : 'disconnected' }).eq('id', target)

  return NextResponse.json({ success: ok, response: resp })
}

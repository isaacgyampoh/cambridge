import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * Save / update a person's own WhatsApp (WAWP) instance credentials.
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

  const { staffId, instanceId, accessToken, number, status } = await req.json()

  // Only super_admin / project_manager can set for others
  const target = staffId && staffId !== session.userId ? staffId : session.userId
  if (target !== session.userId && !['super_admin', 'project_manager'].includes(session.role || '')) {
    return NextResponse.json({ error: 'You can only manage your own WhatsApp line.' }, { status: 403 })
  }

  const sb = createServiceClient()
  const update: any = {}
  if (instanceId !== undefined) update.wawp_instance_id = instanceId || null
  if (accessToken !== undefined) update.wawp_access_token = accessToken || null
  if (number !== undefined) update.wawp_number = number || null
  if (status !== undefined) update.wawp_status = status

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
    .select('wawp_instance_id, wawp_access_token, phone, wawp_number, full_name')
    .eq('id', target).maybeSingle()

  if (!p?.wawp_instance_id || !p?.wawp_access_token) {
    return NextResponse.json({ error: 'No instance credentials set for this person yet.' }, { status: 400 })
  }

  const testTo = p.wawp_number || p.phone
  if (!testTo) return NextResponse.json({ error: 'No phone number to test with.' }, { status: 400 })

  const phone = testTo.replace(/\s+/g, '').replace(/^\+/, '').replace(/^0/, '233')
  let ok = false, resp: any = null
  try {
    const res = await fetch('https://app.wawp.net/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number: phone, type: 'text',
        message: `Cambridge CCE: your WhatsApp line is now connected to the system, ${p.full_name?.split(' ')[0] || ''}. Messages to your leads will come from this number.`,
        instance_id: p.wawp_instance_id,
        access_token: p.wawp_access_token,
      }),
      signal: AbortSignal.timeout(12000),
    })
    resp = await res.json()
    ok = res.ok && resp?.status !== 'error'
  } catch (e: any) {
    resp = { error: e.message }
  }

  // Update status based on result
  await sb.from('profiles').update({ wawp_status: ok ? 'connected' : 'disconnected' }).eq('id', target)

  return NextResponse.json({ success: ok, response: resp })
}

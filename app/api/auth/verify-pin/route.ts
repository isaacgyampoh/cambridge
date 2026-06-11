import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, createSession, ROLE_PORTAL, SESSION_COOKIE } from '@/lib/auth/pin'

export async function POST(req: NextRequest) {
  const { phone, pin } = await req.json()

  if (!phone || !pin) {
    return NextResponse.json({ error: 'Phone number and PIN are required' }, { status: 400 })
  }

  const sb = createServiceClient()
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'

  // Normalize phone — try both 0XX and 233XX formats
  const raw = String(phone).replace(/\s+/g, '')
  const phone233 = raw.startsWith('0') ? '233' + raw.slice(1) : raw.startsWith('+') ? raw.slice(1) : raw
  const phone0   = phone233.startsWith('233') ? '0' + phone233.slice(3) : raw

  // Find user by phone (try both formats)
  const { data: profiles } = await sb.from('profiles')
    .select('*')
    .or(`phone.eq.${phone233},phone.eq.${phone0},phone.eq.${raw}`)
    .eq('is_active', true)
    .limit(1)

  const profile = profiles?.[0]

  if (!profile) {
    await sb.from('login_events').insert({ event_type: 'wrong_pin', ip_address: ip })
    return NextResponse.json({ error: 'Phone number not found. Contact your administrator.' }, { status: 401 })
  }

  // Check if locked
  if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(profile.locked_until).getTime() - Date.now()) / 60000)
    return NextResponse.json({
      error: `Too many wrong PINs. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`
    }, { status: 429 })
  }

  // Verify PIN
  const pinValid = profile.pin_hash && hashPIN(pin) === profile.pin_hash

  if (!pinValid) {
    const attempts = (profile.login_attempts || 0) + 1
    const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null
    await sb.from('profiles').update({ login_attempts: attempts, locked_until: lockUntil }).eq('id', profile.id)
    await sb.from('login_events').insert({ user_id: profile.id, event_type: attempts >= 5 ? 'locked' : 'wrong_pin', ip_address: ip })
    const remaining = 5 - attempts
    return NextResponse.json({
      error: attempts >= 5
        ? 'Account locked for 15 minutes. Contact your administrator.'
        : `Wrong PIN. ${remaining} attempt${remaining !== 1 ? 's' : ''} left.`
    }, { status: 401 })
  }

  // Success
  await sb.from('profiles').update({
    login_attempts: 0, locked_until: null, last_login_at: new Date().toISOString(),
  }).eq('id', profile.id)
  await sb.from('login_events').insert({ user_id: profile.id, event_type: 'success', ip_address: ip })

  const sessionToken = await createSession(profile.id, ip)

  const res = NextResponse.json({
    success: true,
    redirect: ROLE_PORTAL[profile.role] || '/admin',
    role: profile.role,
    fullName: profile.full_name,
    mustChangePIN: profile.must_change_pin || false,
  })

  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 3600,
    path: '/',
  })

  return res
}

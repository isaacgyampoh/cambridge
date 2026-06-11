import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, createSession, ROLE_PORTAL, SESSION_COOKIE } from '@/lib/auth/pin'

export async function POST(req: NextRequest) {
  const { email, pin } = await req.json()

  if (!email || !pin) {
    return NextResponse.json({ error: 'Email and PIN are required' }, { status: 400 })
  }

  const sb = createServiceClient()
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'

  // Find user
  const { data: profile } = await sb.from('profiles')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single()

  if (!profile) {
    await sb.from('login_events').insert({ email, event_type: 'wrong_pin', ip_address: ip })
    return NextResponse.json({ error: 'Invalid email or PIN' }, { status: 401 })
  }

  // Check if account is active
  if (!profile.is_active) {
    return NextResponse.json({ error: 'Your account has been deactivated. Contact your administrator.' }, { status: 403 })
  }

  // Check if locked
  if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(profile.locked_until).getTime() - Date.now()) / 60000)
    return NextResponse.json({ error: `Account locked. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` }, { status: 429 })
  }

  // Verify PIN
  const pinHash = hashPIN(pin)
  const pinValid = profile.pin_hash && pinHash === profile.pin_hash

  if (!pinValid) {
    const attempts = (profile.login_attempts || 0) + 1
    const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null

    await sb.from('profiles').update({
      login_attempts: attempts,
      locked_until: lockUntil,
    }).eq('id', profile.id)

    await sb.from('login_events').insert({ user_id: profile.id, email, event_type: attempts >= 5 ? 'locked' : 'wrong_pin', ip_address: ip })

    const remaining = 5 - attempts
    return NextResponse.json({
      error: attempts >= 5
        ? 'Too many incorrect PINs. Account locked for 15 minutes.'
        : `Incorrect PIN. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
    }, { status: 401 })
  }

  // Success — reset attempts, create session
  await sb.from('profiles').update({
    login_attempts: 0,
    locked_until: null,
    last_login_at: new Date().toISOString(),
  }).eq('id', profile.id)

  await sb.from('login_events').insert({ user_id: profile.id, email, event_type: 'success', ip_address: ip })

  const sessionToken = await createSession(profile.id, ip)

  const res = NextResponse.json({
    success: true,
    redirect: ROLE_PORTAL[profile.role] || '/login',
    role: profile.role,
    fullName: profile.full_name,
    mustChangePIN: profile.must_change_pin || false,
  })

  // Set secure session cookie (8 hours)
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 3600,
    path: '/',
  })

  return res
}

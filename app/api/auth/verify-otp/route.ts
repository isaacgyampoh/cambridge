import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, createSession, ROLE_PORTAL, SESSION_COOKIE } from '@/lib/auth/pin'

const MAX_OTP_ATTEMPTS = 5

/**
 * Step 2 of login: verify the emailed OTP and create the session.
 */
export async function POST(req: NextRequest) {
  const { userId, code } = await req.json()
  if (!userId || !code) return NextResponse.json({ error: 'Enter the 6-digit code from your email' }, { status: 400 })

  const sb = createServiceClient()
  const ip = req.headers.get('x-forwarded-for') || 'unknown'

  const { data: profile } = await sb.from('profiles').select('*').eq('id', userId).eq('is_active', true).maybeSingle()
  if (!profile) return NextResponse.json({ error: 'Session expired. Please start again.' }, { status: 401 })

  // Expired?
  if (!profile.otp_code || !profile.otp_expires_at || new Date(profile.otp_expires_at) < new Date()) {
    return NextResponse.json({ error: 'Your code has expired. Please sign in again to get a new one.' }, { status: 401 })
  }

  // Too many wrong codes?
  if ((profile.otp_attempts || 0) >= MAX_OTP_ATTEMPTS) {
    await sb.from('profiles').update({ otp_code: null, otp_expires_at: null }).eq('id', profile.id)
    return NextResponse.json({ error: 'Too many wrong codes. Please sign in again.' }, { status: 429 })
  }

  // Wrong code?
  if (hashPIN(code) !== profile.otp_code) {
    await sb.from('profiles').update({ otp_attempts: (profile.otp_attempts || 0) + 1 }).eq('id', profile.id)
    try { await sb.from('login_events').insert({ user_id: profile.id, event_type: 'wrong_otp', ip_address: ip }) } catch {}
    const left = MAX_OTP_ATTEMPTS - (profile.otp_attempts || 0) - 1
    return NextResponse.json({ error: `Incorrect code.${left > 0 ? ` ${left} attempt${left !== 1 ? 's' : ''} left.` : ''}` }, { status: 401 })
  }

  // Correct — clear OTP, create session
  await sb.from('profiles').update({
    otp_code: null, otp_expires_at: null, otp_attempts: 0,
    last_login_at: new Date().toISOString(),
  }).eq('id', profile.id)
  try { await sb.from('login_events').insert({ user_id: profile.id, event_type: 'success', ip_address: ip }) } catch {}

  const sessionToken = await createSession(profile.id, ip)
  const res = NextResponse.json({
    success: true,
    redirect: ROLE_PORTAL[profile.role] || '/admin',
    role: profile.role,
    fullName: profile.full_name,
    mustChangePIN: profile.must_change_pin || false,
  })
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', maxAge: 8 * 3600, path: '/',
  })
  return res
}

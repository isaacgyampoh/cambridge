import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  hashToken, createSession, ROLE_PORTAL, SESSION_COOKIE, SESSION_COOKIE_OPTIONS,
} from '@/lib/auth/pin'
import { rateLimit, clientIp, retryMessage } from '@/lib/auth/rateLimit'
import { timingSafeEqual } from 'crypto'
import { z } from 'zod'

export const runtime = 'nodejs'

const MAX_OTP_ATTEMPTS = 5

const Body = z.object({
  userId: z.string().uuid('Please start signing in again.'),
  code: z.string().regex(/^\d{4,8}$/, 'Enter the code from your email'),
})

/** Step 2 of login: verify the emailed one-time code and create the session. */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Enter the code from your email.' },
      { status: 400 }
    )
  }
  const { userId, code } = parsed.data
  const ip = clientIp(req)

  const limit = await rateLimit(`otp:${userId}`, MAX_OTP_ATTEMPTS * 2, 15 * 60, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. ${retryMessage(limit.retryAfter)}` },
      { status: 429 }
    )
  }

  const sb = createServiceClient()
  const { data: profile } = await sb.from('profiles')
    .select('id, full_name, role, email, is_active, must_change_pin, otp_code, otp_expires_at, otp_attempts')
    .eq('id', userId).eq('is_active', true).maybeSingle()

  if (!profile) return NextResponse.json({ error: 'Your sign-in has expired. Please start again.' }, { status: 401 })

  if (!profile.otp_code || !profile.otp_expires_at || new Date(profile.otp_expires_at) < new Date()) {
    return NextResponse.json({ error: 'That code has expired. Please sign in again to get a new one.' }, { status: 401 })
  }

  if ((profile.otp_attempts || 0) >= MAX_OTP_ATTEMPTS) {
    await sb.from('profiles').update({ otp_code: null, otp_expires_at: null }).eq('id', profile.id)
    return NextResponse.json({ error: 'Too many incorrect codes. Please sign in again.' }, { status: 429 })
  }

  // Timing-safe comparison of the hashed code.
  const supplied = Buffer.from(hashToken(code), 'hex')
  const expected = Buffer.from(profile.otp_code, 'hex')
  const matches = supplied.length === expected.length && timingSafeEqual(supplied, expected)

  if (!matches) {
    const used = (profile.otp_attempts || 0) + 1
    await sb.from('profiles').update({ otp_attempts: used }).eq('id', profile.id)
    try { await sb.from('login_events').insert({ user_id: profile.id, event_type: 'wrong_otp', ip_address: ip }) } catch {}
    const left = MAX_OTP_ATTEMPTS - used
    return NextResponse.json(
      { error: `That code is not correct.${left > 0 ? ` ${left} attempt${left === 1 ? '' : 's'} left.` : ''}` },
      { status: 401 }
    )
  }

  // Correct — burn the code and open the session.
  await sb.from('profiles').update({
    otp_code: null, otp_expires_at: null, otp_attempts: 0,
    login_attempts: 0, locked_until: null,
    last_login_at: new Date().toISOString(),
  }).eq('id', profile.id)
  try { await sb.from('login_events').insert({ user_id: profile.id, event_type: 'success', ip_address: ip }) } catch {}

  const token = await createSession(profile.id, ip)
  const res = NextResponse.json({
    success: true,
    redirect: ROLE_PORTAL[profile.role] || '/admin',
    role: profile.role,
    fullName: profile.full_name,
    mustChangePIN: profile.must_change_pin || false,
  })
  res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS)
  return res
}

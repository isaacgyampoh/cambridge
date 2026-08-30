import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  hashPIN, verifyPIN, hashToken, generateOTP, createSession,
  ROLE_PORTAL, SESSION_COOKIE, SESSION_COOKIE_OPTIONS,
} from '@/lib/auth/pin'
import { rateLimit, clearRateLimit, clientIp, retryMessage } from '@/lib/auth/rateLimit'
import { sendOTPEmail } from '@/lib/integrations/email'
import { SECRETS } from '@/lib/config.server'
import { z } from 'zod'

export const runtime = 'nodejs'

const MAX_PIN_ATTEMPTS = 5
const LOCK_MINUTES = 15

const Body = z.object({
  identifier: z.string().trim().min(3, 'Enter your staff email or phone number').max(120),
  pin: z.string().regex(/^\d{4,8}$/, 'Your PIN is 4 to 8 digits'),
})

/** Normalise a Ghanaian phone number so 0201234567 and 233201234567 match. */
function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return []
  const local = digits.replace(/^233/, '').replace(/^0/, '')
  return Array.from(new Set([digits, local, `0${local}`, `233${local}`]))
}

/**
 * Step 1 of login: identify the user, then verify their PIN.
 *
 * The previous version looked an account up BY PIN HASH ALONE — there was no
 * username at all, so the PIN was the entire credential for the whole
 * organisation and any of the 10,000 four-digit values would match whichever
 * member of staff happened to have chosen it. It also declared
 * MAX_PIN_ATTEMPTS and LOCK_MINUTES without ever using them: login_attempts
 * was only ever reset to zero, never incremented, and the lockout was checked
 * only AFTER the PIN had already matched, where it could do nothing.
 *
 * Now: the account is found by email or phone, the PIN is verified against
 * that one row, failures are counted and lock the account, and the endpoint is
 * throttled per IP and per account.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Enter your email or phone and your PIN.' },
      { status: 400 }
    )
  }
  const { identifier, pin } = parsed.data
  const ip = clientIp(req)

  // Throttle by IP first, before any database lookup, so a scripted attacker
  // cannot use this endpoint as an account-enumeration oracle either.
  const ipLimit = await rateLimit(`login:ip:${ip}`, 20, 15 * 60, 15 * 60)
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: `Too many sign-in attempts from this connection. ${retryMessage(ipLimit.retryAfter)}` },
      { status: 429 }
    )
  }

  const sb = createServiceClient()

  // Look the account up by who they say they are — never by the secret.
  const isEmail = identifier.includes('@')
  let profile: Record<string, unknown> | null = null

  if (isEmail) {
    const { data } = await sb.from('profiles')
      .select('id, full_name, email, phone, role, pin_hash, is_active, must_change_pin, login_attempts, locked_until, last_login_at')
      .eq('email', identifier.toLowerCase()).eq('is_active', true).maybeSingle()
    profile = data
  } else {
    const { data } = await sb.from('profiles')
      .select('id, full_name, email, phone, role, pin_hash, is_active, must_change_pin, login_attempts, locked_until, last_login_at')
      .in('phone', phoneVariants(identifier)).eq('is_active', true).limit(1).maybeSingle()
    profile = data
  }

  // One message whether the account is unknown or the PIN is wrong, so this
  // endpoint does not reveal which staff emails or numbers exist.
  const REJECT = { error: 'Those sign-in details are not correct.' }

  if (!profile) {
    try { await sb.from('login_events').insert({ event_type: 'unknown_account', ip_address: ip }) } catch {}
    return NextResponse.json(REJECT, { status: 401 })
  }

  const userId = profile.id as string

  // Locked out? Checked BEFORE the PIN is verified, which is the only place
  // the check is worth anything.
  const lockedUntil = profile.locked_until as string | null
  if (lockedUntil && new Date(lockedUntil) > new Date()) {
    const mins = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60000))
    return NextResponse.json(
      { error: `This account is locked after too many incorrect PINs. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` },
      { status: 429 }
    )
  }

  const accountLimit = await rateLimit(`login:user:${userId}`, MAX_PIN_ATTEMPTS * 2, 15 * 60, LOCK_MINUTES * 60)
  if (!accountLimit.allowed) {
    return NextResponse.json(
      { error: `Too many sign-in attempts for this account. ${retryMessage(accountLimit.retryAfter)}` },
      { status: 429 }
    )
  }

  const { ok, needsRehash } = await verifyPIN(pin, (profile.pin_hash as string) || '')

  if (!ok) {
    const attempts = ((profile.login_attempts as number) || 0) + 1
    const update: Record<string, unknown> = { login_attempts: attempts }
    if (attempts >= MAX_PIN_ATTEMPTS) {
      update.locked_until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString()
      update.login_attempts = 0
    }
    await sb.from('profiles').update(update).eq('id', userId)
    try { await sb.from('login_events').insert({ user_id: userId, event_type: 'wrong_pin', ip_address: ip }) } catch {}

    if (attempts >= MAX_PIN_ATTEMPTS) {
      return NextResponse.json(
        { error: `Too many incorrect PINs. This account is locked for ${LOCK_MINUTES} minutes.` },
        { status: 429 }
      )
    }
    return NextResponse.json(REJECT, { status: 401 })
  }

  // Correct PIN. Move the account off the old SHA-256 scheme if needed.
  if (needsRehash) {
    try {
      await sb.from('profiles').update({ pin_hash: await hashPIN(pin) }).eq('id', userId)
    } catch { /* verification already succeeded; never fail a login over this */ }
  }

  await clearRateLimit(`login:user:${userId}`)

  const role = profile.role as string
  const mustChangePIN = Boolean(profile.must_change_pin)

  // ── Second factor ──
  // OTP is no longer waived for super_admin — that exempted precisely the
  // account most worth protecting. It is skipped only when OTP is switched
  // off for the whole deployment, or when there is no address to send to.
  const email = profile.email as string | null
  if (!SECRETS.otpEnabled || !email) {
    return await grantSession()
  }

  const code = generateOTP(6)
  const { error: otpErr } = await sb.from('profiles').update({
    otp_code: hashToken(code),
    otp_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    otp_attempts: 0,
    login_attempts: 0,
    locked_until: null,
  }).eq('id', userId)

  if (otpErr) {
    console.error('[verify-pin] could not store OTP:', otpErr.message)
    return NextResponse.json({ error: 'Could not start the sign-in code step. Please try again.' }, { status: 500 })
  }

  const sent = await sendOTPEmail(email, (profile.full_name as string) || '', code)
  if (!sent) {
    return NextResponse.json(
      { error: 'Could not send your sign-in code by email. Please try again shortly.' },
      { status: 502 }
    )
  }

  const [u, d] = email.split('@')
  const masked = `${u[0]}${'•'.repeat(Math.max(1, u.length - 1))}@${d}`
  return NextResponse.json({ success: true, otpRequired: true, userId, emailHint: masked })

  async function grantSession() {
    await sb.from('profiles').update({
      login_attempts: 0, locked_until: null, last_login_at: new Date().toISOString(),
    }).eq('id', userId)
    try { await sb.from('login_events').insert({ user_id: userId, event_type: 'success', ip_address: ip }) } catch {}

    const token = await createSession(userId, ip)
    const res = NextResponse.json({
      success: true,
      redirect: ROLE_PORTAL[role] || '/admin',
      role,
      fullName: profile!.full_name,
      mustChangePIN,
    })
    res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS)
    return res
  }
}

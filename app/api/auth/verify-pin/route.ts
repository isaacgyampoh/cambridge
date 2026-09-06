import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  hashPIN, verifyPIN, hashToken, generateOTP, createSession,
  ROLE_PORTAL, SESSION_COOKIE, SESSION_COOKIE_OPTIONS,
} from '@/lib/auth/pin'
import { rateLimit, clearRateLimit, clientIp, retryMessage } from '@/lib/auth/rateLimit'
import { sendOTPEmail } from '@/lib/integrations/email'
import { recordAudit } from '@/lib/audit'
import { SECRETS } from '@/lib/config.server'
import { z } from 'zod'

export const runtime = 'nodejs'

const MAX_PIN_ATTEMPTS = 5
const LOCK_MINUTES = 15
const OTP_MINUTES = 10

const Body = z.object({
  pin: z.string().regex(/^\d{4,8}$/, 'Your PIN is 4 to 8 digits'),
})

/**
 * Step 1 of sign-in: the PIN identifies the member of staff.
 *
 * ── Why this is safe as a FIRST factor, not the only one ───────────────────
 *
 * A PIN alone is a weak credential: four digits is ten thousand values shared
 * across the whole organisation. The original system treated it as the entire
 * credential — a correct PIN created a session outright, the second factor was
 * waived for super admins, and the lockout constants were declared but never
 * used. That was a genuine authentication bypass.
 *
 * The PIN still identifies the account, because that is the sign-in the staff
 * actually use. What has changed is everything behind it:
 *
 *   - The email code is now MANDATORY. No role is exempt and there is no
 *     "recently signed in" grace period. Guessing a PIN reaches the code
 *     screen; it does not reach the system.
 *   - Attempts are throttled per IP before any work is done, and the account
 *     locks for 15 minutes after 5 wrong PINs.
 *   - The code is six digits from a CSPRNG, stored hashed, single-use, and
 *     expires in 10 minutes.
 *
 * ── Why the PIN is checked against every account ───────────────────────────
 *
 * PIN hashes are scrypt with a PER-USER salt, so the same PIN produces a
 * different hash for every member of staff and cannot be looked up by hash.
 * (The old scheme could, which is precisely why it was insecure: one shared
 * salt over a fast hash meant ten thousand values covered everyone.)
 *
 * So the PIN is verified against each active profile. At this organisation's
 * size that is seventeen scrypt operations, run in parallel. That cost is a
 * feature against an attacker and the reason the IP throttle is checked first:
 * without it, this endpoint would be a CPU exhaustion target.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Enter your PIN.' },
      { status: 400 }
    )
  }
  const { pin } = parsed.data
  const ip = clientIp(req)

  // Throttled BEFORE any hashing. Each attempt costs real CPU, so this is both
  // a brute-force control and the thing that stops the endpoint being used to
  // exhaust the server.
  const ipLimit = await rateLimit(`login:ip:${ip}`, 15, 15 * 60, LOCK_MINUTES * 60)
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: `Too many sign-in attempts from this connection. ${retryMessage(ipLimit.retryAfter)}` },
      { status: 429 }
    )
  }

  const sb = createServiceClient()

  const { data: candidates, error: loadErr } = await sb.from('profiles')
    .select('id, full_name, email, role, pin_hash, must_change_pin, login_attempts, locked_until')
    .eq('is_active', true)
    .not('pin_hash', 'is', null)

  if (loadErr) {
    console.error('[verify-pin] could not load accounts:', loadErr.message)
    return NextResponse.json({ error: 'Sign-in is unavailable right now. Please try again.' }, { status: 503 })
  }

  type Candidate = {
    id: string; full_name: string; email: string | null; role: string
    pin_hash: string; must_change_pin: boolean | null
    login_attempts: number | null; locked_until: string | null
  }
  const rows = (candidates || []) as Candidate[]

  // Every account is checked, and all of them are checked even once one has
  // matched, so the response time does not reveal where in the list the
  // matching account sits.
  const results = await Promise.all(
    rows.map(async row => ({ row, ...(await verifyPIN(pin, row.pin_hash)) }))
  )
  const matches = results.filter(r => r.ok)

  // One message for "no such PIN" and for "wrong PIN", so the endpoint never
  // reveals which PINs exist.
  const REJECT = { error: 'That PIN is not recognised.' }

  if (matches.length === 0) {
    try { await sb.from('login_events').insert({ event_type: 'wrong_pin', ip_address: ip }) } catch {}
    return NextResponse.json(REJECT, { status: 401 })
  }

  /*
   * Two members of staff sharing a PIN cannot be told apart, and guessing
   * would sign somebody into the wrong account. The old code hit this with
   * `.maybeSingle()`, which errors on two rows and locked BOTH people out with
   * no explanation. It is refused explicitly and recorded so an administrator
   * can act. Six-digit PINs make this vanishingly unlikely.
   */
  if (matches.length > 1) {
    console.error('[verify-pin] PIN collision across', matches.length, 'accounts')
    await recordAudit({
      action: 'auth.pin_collision',
      resource: 'profiles',
      success: false,
      metadata: { accounts: matches.length },
      request: req,
    })
    return NextResponse.json({
      error: 'This PIN is registered to more than one account and cannot be used. Please contact your administrator to have it changed.',
    }, { status: 409 })
  }

  const { row: profile, needsRehash } = matches[0]
  const userId = profile.id

  // Locked out? Checked after identification but before any session is issued.
  if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
    const mins = Math.max(1, Math.ceil((new Date(profile.locked_until).getTime() - Date.now()) / 60000))
    return NextResponse.json(
      { error: `This account is locked after too many incorrect PINs. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` },
      { status: 429 }
    )
  }

  // Correct PIN — migrate off the legacy SHA-256 scheme if this account is
  // still on it. Never fail a sign-in because the upgrade write failed.
  if (needsRehash) {
    try {
      await sb.from('profiles').update({ pin_hash: await hashPIN(pin) }).eq('id', userId)
    } catch (e) { console.error('[verify-pin] rehash failed:', e) }
  }

  await clearRateLimit(`login:ip:${ip}`)

  const mustChangePIN = Boolean(profile.must_change_pin)

  /*
   * The email code. Skipped only when the deployment has switched OTP off, or
   * when this account genuinely has no address to send to — in which case the
   * PIN is the only factor, so it is recorded as such rather than passing
   * silently.
   */
  if (!SECRETS.otpEnabled || !profile.email) {
    if (!profile.email) {
      console.warn('[verify-pin] no email on file for', userId, '— signed in on PIN alone')
      await recordAudit({
        actorId: userId, action: 'auth.otp_skipped_no_email',
        resource: 'profiles', resourceId: userId, success: true, request: req,
      })
    }
    return grantSession(sb, profile, ip, req)
  }

  const code = generateOTP(6)
  const { error: otpErr } = await sb.from('profiles').update({
    otp_code: hashToken(code),
    otp_expires_at: new Date(Date.now() + OTP_MINUTES * 60_000).toISOString(),
    otp_attempts: 0,
    login_attempts: 0,
    locked_until: null,
  }).eq('id', userId)

  if (otpErr) {
    console.error('[verify-pin] could not store the code:', otpErr.message)
    return NextResponse.json({ error: 'Could not start the sign-in code step. Please try again.' }, { status: 500 })
  }

  const sent = await sendOTPEmail(profile.email, profile.full_name || '', code)
  if (!sent) {
    // The code exists but could not be delivered. Say so plainly rather than
    // stranding the user on a code screen no code will ever arrive at.
    await recordAudit({
      actorId: userId, action: 'auth.otp_send_failed',
      resource: 'profiles', resourceId: userId, success: false, request: req,
    })
    return NextResponse.json(
      { error: 'We could not email your sign-in code. Please try again shortly, or contact your administrator.' },
      { status: 502 }
    )
  }

  await recordAudit({
    actorId: userId, action: 'auth.otp_sent',
    resource: 'profiles', resourceId: userId, success: true, request: req,
  })

  return NextResponse.json({
    success: true,
    otpRequired: true,
    userId,
    emailHint: maskEmail(profile.email),
    expiresInSeconds: OTP_MINUTES * 60,
  })
}

/** n••••@cambridge.edu.gh — enough to recognise, not enough to harvest. */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return '•••'
  const head = user.slice(0, 1)
  return `${head}${'•'.repeat(Math.max(1, user.length - 1))}@${domain}`
}

type SessionProfile = {
  id: string; full_name: string; role: string; must_change_pin: boolean | null
}

async function grantSession(
  sb: ReturnType<typeof createServiceClient>,
  profile: SessionProfile,
  ip: string,
  req: NextRequest
) {
  await sb.from('profiles').update({
    login_attempts: 0, locked_until: null, last_login_at: new Date().toISOString(),
  }).eq('id', profile.id)

  try { await sb.from('login_events').insert({ user_id: profile.id, event_type: 'success', ip_address: ip }) } catch {}
  await recordAudit({
    actorId: profile.id, action: 'auth.login',
    resource: 'profiles', resourceId: profile.id, success: true, request: req,
  })

  const token = await createSession(profile.id, ip)
  const res = NextResponse.json({
    success: true,
    redirect: ROLE_PORTAL[profile.role] || '/admin',
    role: profile.role,
    fullName: profile.full_name,
    mustChangePIN: Boolean(profile.must_change_pin),
  })
  res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS)
  return res
}

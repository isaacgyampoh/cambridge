import { OTP_MINUTES } from '@/lib/auth/otpPolicy'
import { NextRequest, NextResponse } from 'next/server'
import { PIN_PATTERN, PIN_LENGTH, NO_MAILBOX_ROLES } from '@/lib/auth/pinPolicy'
import { maskEmail } from '@/lib/ui/contact'
import { createServiceClient } from '@/lib/supabase/server'
import {
  hashPIN, verifyPIN, hashToken, generateOTP, createSession,
  ROLE_PORTAL, SESSION_COOKIE, SESSION_COOKIE_OPTIONS,
} from '@/lib/auth/pin'
import { rateLimit, clearRateLimit, clientIp, retryMessage, isBlocked, recordFailure } from '@/lib/auth/rateLimit'
import { sendOTPEmail } from '@/lib/integrations/email'
import { recordAudit } from '@/lib/audit'
import { SECRETS } from '@/lib/config.server'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * Roles that sign in on the PIN alone, without the emailed code.
 *
 * Deliberately a named list rather than an inline role check, so that adding
 * a role here is a visible decision about who may hold full access behind a
 * single factor — not a condition buried in a branch.
 */
/**
 * Who signs in without an emailed code.
 *
 * Read from lib/auth/pinPolicy.ts so this and the recovery path cannot
 * disagree about which accounts have no mailbox — a disagreement there means
 * an account that can be signed in but not recovered.
 */
const OTP_EXEMPT_ROLES: readonly string[] = NO_MAILBOX_ROLES

const LOCK_MINUTES = 15


/*
 * Brute-force protection when the PIN is the identifier.
 *
 * A per-account lockout is impossible here and it is worth being explicit
 * about why: a WRONG pin matches nobody, so there is no account to lock. The
 * original code declared MAX_PIN_ATTEMPTS and a lockout and never wired them
 * up — and the first PIN-only rewrite in this branch reintroduced exactly
 * that, leaving locked_until checked but never set.
 *
 * Two ceilings replace it, and both are real:
 *
 *   PER IP     ordinary throttling, defeated by rotating addresses
 *   GLOBAL     a system-wide ceiling on failed PINs, which rotating
 *              addresses does NOT defeat
 *
 * Seventeen members of staff do not collectively fail sixty PINs in ten
 * minutes, so crossing that line means somebody is guessing. The block is
 * deliberately short: it must cost an attacker their throughput without
 * handing them a way to keep the team locked out all afternoon.
 */
const GLOBAL_KEY = 'login:global-failures'
const GLOBAL_FAIL_CEILING = 60
const GLOBAL_WINDOW_SECONDS = 10 * 60
const GLOBAL_BLOCK_SECONDS = 5 * 60

const Body = z.object({
  // Exactly four digits — lib/auth/pinPolicy.ts is the only place that says so.
  pin: z.string().regex(PIN_PATTERN, `Your PIN is ${PIN_LENGTH} digits`),
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
 *     expires in six hours.
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

  /*
   * The global ceiling. Checked before any scrypt work, so a distributed
   * attack costs the server nothing once it trips.
   */
  const globalLimit = await isBlocked(GLOBAL_KEY)
  if (globalLimit.blocked) {
    console.error('[verify-pin] GLOBAL PIN ceiling reached — sign-in paused for everyone.',
      'This is what a distributed guessing attempt looks like.')
    return NextResponse.json(
      { error: `Sign-in is temporarily paused. ${retryMessage(globalLimit.retryAfter)}` },
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
    // Counted here, on the failure itself — not at the top of the request,
    // where every successful sign-in would spend the same budget.
    await recordFailure(GLOBAL_KEY, GLOBAL_FAIL_CEILING, GLOBAL_WINDOW_SECONDS, GLOBAL_BLOCK_SECONDS)
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

  /*
   * An administrator can still lock an account by hand by setting
   * locked_until; that is honoured here. Nothing in this flow SETS it, because
   * a wrong PIN identifies nobody to lock — the ceilings above are what stop
   * guessing.
   */
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

  /*
   * A correct PIN clears this address's budget. The global counter is left
   * alone deliberately: it exists to notice a burst of FAILURES across the
   * system, and one success in the middle of an attack does not mean the
   * attack stopped.
   */
  await clearRateLimit(`login:ip:${ip}`)

  /*
   * The email code.
   *
   * Skipped in three cases, each recorded rather than passing silently:
   *
   *   1. OTP is switched off for the whole deployment.
   *   2. The account has no address to send to.
   *   3. The account is exempt — currently the super admin, by request.
   *
   * On case 3, be clear about the trade: the PIN then becomes the ONLY thing
   * standing in front of full access to every student record, payment and
   * staff account. A four-digit PIN is ten thousand guesses; the per-IP
   * throttle above is what makes that slow rather than instant, so it matters
   * more for this account than any other.
   *
   * Every such sign-in is written to the audit log as auth.login_without_otp,
   * so an administrator can see when full access was granted on one factor.
   */
  const otpExempt = OTP_EXEMPT_ROLES.includes(profile.role)

  /*
   * An account that is NOT exempt and has no email cannot be signed in.
   *
   * This previously fell through to a session on the PIN alone, which turned a
   * missing email address into an OTP bypass — the one thing standing between
   * a guessed PIN and full access, removed by an incomplete staff record. The
   * exemption is a deliberate property of a role, not an accident of data.
   */
  if (!otpExempt && SECRETS.otpEnabled && !profile.email) {
    console.error('[verify-pin] refusing sign-in: no email on file for', userId)
    await recordAudit({
      actorId: userId, action: 'auth.login_blocked_no_email',
      resource: 'profiles', resourceId: userId, success: false, request: req,
      metadata: { role: profile.role },
    })
    return NextResponse.json({
      error: 'This account has no email address on file, so a sign-in code cannot be sent. '
        + 'Ask an administrator to add one.',
    }, { status: 403 })
  }

  if (!SECRETS.otpEnabled || otpExempt) {
    const reason = otpExempt ? 'role_exempt' : 'otp_disabled_for_deployment'

    await recordAudit({
      actorId: userId,
      action: 'auth.login_without_otp',
      resource: 'profiles',
      resourceId: userId,
      success: true,
      metadata: { reason, role: profile.role },
      request: req,
    })

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

  /*
   * Reaching here means the account is not exempt and OTP is enabled, so the
   * guard above has already refused a missing address. Restated for the type
   * checker, and as a belt-and-braces refusal rather than an assertion — if
   * this were ever reachable, sending nowhere would silently strand somebody
   * on a code screen.
   */
  if (!profile.email) {
    console.error('[verify-pin] unreachable: OTP path with no email for', userId)
    return NextResponse.json(
      { error: 'This account has no email address on file. Ask an administrator to add one.' },
      { status: 403 }
    )
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

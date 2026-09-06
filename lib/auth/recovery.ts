import 'server-only'
import { randomBytes, randomInt } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, verifyPIN, hashToken, generateOTP } from '@/lib/auth/pin'
import {
  generatePin, isValidPin, pinRejectionReason, OTP_LENGTH, NO_MAILBOX_ROLES,
} from '@/lib/auth/pinPolicy'

/**
 * Account recovery.
 *
 * ── TWO PATHS, BECAUSE THERE ARE TWO KINDS OF ACCOUNT ──────────────────────
 *
 *   STAFF        recovery PIN  →  OTP to the corporate email  →  new PIN
 *   SUPER ADMIN  recovery PIN  →  new PIN
 *
 * The super admin has no corporate mailbox and does not use OTP — that is the
 * product rule, and it is also why they were the one account that could become
 * permanently locked out. A recovery flow that depends on email cannot recover
 * an account that has no email.
 *
 * So recovery branches on the same rule sign-in branches on. Staff keep their
 * second factor; the super admin does not acquire one they cannot use.
 *
 * ── WHAT PROTECTS THE SUPER ADMIN PATH ─────────────────────────────────────
 *
 * Honestly: less than protects staff, because there is no second factor to
 * lean on. A four-digit recovery PIN is ten thousand possibilities, so the
 * protection has to come from making guesses expensive rather than from a
 * second credential:
 *
 *   · a strict per-address budget
 *   · a global ceiling that rotating addresses does not defeat
 *   · a dedicated super-admin recovery ceiling that seals the path for an
 *     hour after a handful of failures
 *   · every attempt audited, so a guessing run is visible afterwards
 *
 * An attacker gets a few guesses per hour out of ten thousand. The legitimate
 * owner, who knows the PIN, is unaffected. This is a deliberate trade against
 * the alternative — an owner permanently locked out of their own system, which
 * is what the previous design produced twice.
 *
 * ── WHAT IS NEVER TRUE ON EITHER PATH ──────────────────────────────────────
 *
 * The recovery PIN never authenticates anybody. It authorises exactly one
 * action: setting a new PIN. What it yields is a RESET TOKEN — single use,
 * fifteen minutes, and the proxy has never heard of it — not a session. After
 * recovery the person returns to the sign-in screen and comes in through the
 * front door.
 *
 * And the recovery PIN is never consumed by a successful recovery, so it works
 * again next time. Making it single-shot is how the super admin came to be
 * locked out a second time.
 */

const RESET_TOKEN_MINUTES = 15

/**
 * Re-exported so callers of this module read the same list sign-in does.
 * Declared in lib/auth/pinPolicy.ts — see NO_MAILBOX_ROLES there.
 */
export const SELF_RECOVERING_ROLES = NO_MAILBOX_ROLES
export const OTP_MINUTES = 10

export type RecoveryStart =
  | {
      ok: true
      userId: string
      /**
       * Whether this account must confirm with an emailed code.
       *
       * False for the super admin, who has no mailbox. The caller branches on
       * this rather than assuming every account takes the same path.
       */
      needsCode: boolean
      /** Present only when needsCode is false: recovery is already authorised. */
      resetToken?: string
      emailHint: string
      expiresInSeconds: number
      /**
       * The plaintext code, for the caller to EMAIL.
       *
       * It must never reach the HTTP response — the route sends it and drops
       * it. Returned rather than emailed here so the transport can change
       * without touching the security logic, and so this module stays
       * testable.
       */
      /** Present only when needsCode is true. Never returned over HTTP. */
      code: string | null
      /** Where to send it, and who to address. Never returned over HTTP. */
      email: string | null
      fullName: string
    }
  | { ok: false; reason: string; status: number }

/**
 * Step 1 — find the account this recovery PIN belongs to, and email it a code.
 *
 * Verifies against every active account that has a recovery PIN, exactly as
 * sign-in verifies the account PIN, because there is no username to narrow it
 * down. Two accounts sharing a recovery PIN is refused rather than guessed at,
 * for the same reason a PIN collision is.
 */
export async function startRecovery(pin: string): Promise<RecoveryStart> {
  if (!isValidPin(pin)) {
    return { ok: false, reason: 'That recovery PIN is not recognised.', status: 400 }
  }

  const sb = createServiceClient()
  const { data: rows, error } = await sb.from('profiles')
    .select('id, full_name, email, role, recovery_pin_hash, is_active')
    .eq('is_active', true)
    .not('recovery_pin_hash', 'is', null)

  if (error) {
    console.error('[recover] could not load accounts:', error.message)
    return { ok: false, reason: 'Recovery is unavailable right now. Please try again.', status: 500 }
  }

  const matches: Array<{ id: string; email: string | null; fullName: string; role: string }> = []
  for (const row of rows || []) {
    const { ok } = await verifyPIN(pin, row.recovery_pin_hash as string)
    if (ok) matches.push({ id: row.id, email: row.email, fullName: row.full_name, role: row.role })
  }

  // Deliberately the same wording as a non-match: telling an attacker that a
  // recovery PIN is real but ambiguous is telling them it is real.
  if (matches.length !== 1) {
    if (matches.length > 1) {
      console.error('[recover] recovery PIN collision across', matches.length, 'accounts')
    }
    return { ok: false, reason: 'That recovery PIN is not recognised.', status: 401 }
  }

  const account = matches[0]

  /*
   * The super admin has no mailbox, so there is no code to send. Verifying the
   * recovery PIN is the whole authorisation, and what comes back is a reset
   * token — permission to set a new PIN, not a session.
   */
  if (SELF_RECOVERING_ROLES.includes(account.role)) {
    const token = await issueResetToken(account.id)
    if (!token) {
      return { ok: false, reason: 'Recovery is unavailable right now. Please try again.', status: 500 }
    }
    return {
      ok: true,
      userId: account.id,
      needsCode: false,
      resetToken: token,
      emailHint: '',
      expiresInSeconds: RESET_TOKEN_MINUTES * 60,
      code: null,
      email: null,
      fullName: account.fullName,
    }
  }

  if (!account.email) {
    return {
      ok: false,
      status: 400,
      reason: 'This account has no corporate email address, so a code cannot be sent. Contact your administrator.',
    }
  }

  const code = generateOTP(OTP_LENGTH)
  const expires = new Date(Date.now() + OTP_MINUTES * 60_000).toISOString()

  const { error: writeErr } = await sb.from('profiles').update({
    otp_code: hashToken(code),      // never stored in the clear
    otp_expires_at: expires,
    otp_attempts: 0,
  }).eq('id', account.id)

  if (writeErr) {
    console.error('[recover] could not store the code:', writeErr.message)
    return { ok: false, reason: 'Recovery is unavailable right now. Please try again.', status: 500 }
  }

  return {
    ok: true,
    userId: account.id,
    needsCode: true,
    emailHint: maskEmail(account.email),
    expiresInSeconds: OTP_MINUTES * 60,
    code,
    email: account.email,
    fullName: account.fullName,
  }
}

/**
 * Mint the single-use permission to set a new PIN.
 *
 * Shared by both paths, so the token has identical properties however it was
 * earned: stored hashed, expires, and cleared the moment it is spent.
 */
async function issueResetToken(userId: string): Promise<string | null> {
  const sb = createServiceClient()
  const token = randomBytes(32).toString('hex')
  const { error } = await sb.from('profiles').update({
    otp_code: null,
    otp_expires_at: null,
    otp_attempts: 0,
    reset_token_hash: hashToken(token),
    reset_token_expires_at: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000).toISOString(),
  }).eq('id', userId)

  if (error) {
    console.error('[recover] could not issue the reset token:', error.message)
    return null
  }
  return token
}

export type RecoveryVerify =
  | { ok: true; resetToken: string }
  | { ok: false; reason: string; status: number }

/**
 * Step 2 — check the emailed code and issue the single-use reset token.
 *
 * The token is returned to the browser once and stored hashed, the same way a
 * session token is. It is not a session: nothing but completeRecovery accepts
 * it, and it expires in fifteen minutes.
 */
export async function verifyRecoveryCode(
  userId: string,
  code: string,
  maxAttempts = 5
): Promise<RecoveryVerify> {
  const sb = createServiceClient()
  const { data: profile, error } = await sb.from('profiles')
    .select('id, otp_code, otp_expires_at, otp_attempts, is_active')
    .eq('id', userId).maybeSingle()

  if (error || !profile || !profile.is_active) {
    return { ok: false, reason: 'That code is no longer valid. Start again.', status: 401 }
  }
  if (!profile.otp_code || !profile.otp_expires_at) {
    return { ok: false, reason: 'That code is no longer valid. Start again.', status: 401 }
  }
  if (new Date(profile.otp_expires_at) < new Date()) {
    return { ok: false, reason: 'That code has expired. Start again.', status: 401 }
  }

  const used = (profile.otp_attempts || 0) + 1
  if (used > maxAttempts) {
    // Clear it outright: a code being guessed is a code that must stop working.
    await sb.from('profiles')
      .update({ otp_code: null, otp_expires_at: null }).eq('id', userId)
    return { ok: false, reason: 'Too many incorrect codes. Start again.', status: 429 }
  }

  if (hashToken(code) !== profile.otp_code) {
    await sb.from('profiles').update({ otp_attempts: used }).eq('id', userId)
    return { ok: false, reason: 'That code is not correct.', status: 401 }
  }

  const token = await issueResetToken(userId)
  if (!token) {
    return { ok: false, reason: 'Recovery is unavailable right now. Please try again.', status: 500 }
  }

  return { ok: true, resetToken: token }
}

export type RecoveryComplete =
  | { ok: true; userId: string }
  | { ok: false; reason: string; status: number }

/**
 * Step 3 — set the new PIN.
 *
 * The whole policy applies: exactly four digits, not a guessable pattern, and
 * not already in use by another active account — recovery is not an exemption
 * from the rules that keep PIN-only sign-in workable.
 *
 * The recovery PIN is deliberately left alone, so the account can be recovered
 * again if this new PIN is forgotten too.
 */
export async function completeRecovery(
  resetToken: string,
  newPin: string
): Promise<RecoveryComplete> {
  const rejection = pinRejectionReason(newPin)
  if (rejection) return { ok: false, reason: rejection, status: 400 }

  const sb = createServiceClient()
  const { data: profile, error } = await sb.from('profiles')
    .select('id, reset_token_expires_at, is_active')
    .eq('reset_token_hash', hashToken(resetToken))
    .maybeSingle()

  if (error || !profile || !profile.is_active) {
    return { ok: false, reason: 'This reset link is no longer valid. Start again.', status: 401 }
  }
  if (!profile.reset_token_expires_at || new Date(profile.reset_token_expires_at) < new Date()) {
    return { ok: false, reason: 'This reset expired. Start again.', status: 401 }
  }

  /*
   * A PIN already in use by somebody else cannot be allowed.
   *
   * Sign-in tries the submitted PIN against every active account, so two
   * accounts sharing one makes BOTH unusable — the request is refused with a
   * 409 rather than guessing which person it is.
   */
  const { data: others } = await sb.from('profiles')
    .select('id, pin_hash')
    .eq('is_active', true)
    .not('pin_hash', 'is', null)
    .neq('id', profile.id)

  for (const other of others || []) {
    const { ok } = await verifyPIN(newPin, other.pin_hash as string)
    if (ok) {
      return {
        ok: false,
        status: 409,
        reason: 'That PIN is already in use. Please choose a different one.',
      }
    }
  }

  const { error: writeErr } = await sb.from('profiles').update({
    pin_hash: await hashPIN(newPin),
    pin_set_at: new Date().toISOString(),
    must_change_pin: false,
    login_attempts: 0,
    locked_until: null,
    // Single use.
    reset_token_hash: null,
    reset_token_expires_at: null,
    // recovery_pin_hash is untouched on purpose: recovery must work again.
  }).eq('id', profile.id)

  if (writeErr) {
    console.error('[recover] could not set the new PIN:', writeErr.message)
    return { ok: false, reason: 'Could not set your new PIN. Please try again.', status: 500 }
  }

  return { ok: true, userId: profile.id }
}

/**
 * Give an account a recovery PIN. Used by first-run and by an administrator.
 *
 * Returns the PIN to the caller exactly once; it is stored only as a hash.
 */
export async function setRecoveryPin(
  userId: string,
  pin?: string
): Promise<{ ok: true; pin: string } | { ok: false; reason: string }> {
  const chosen = pin ?? generatePin(randomInt)
  const rejection = pinRejectionReason(chosen)
  if (rejection) return { ok: false, reason: rejection }

  const sb = createServiceClient()
  const { error } = await sb.from('profiles').update({
    recovery_pin_hash: await hashPIN(chosen),
    recovery_pin_set_at: new Date().toISOString(),
  }).eq('id', userId)

  if (error) {
    console.error('[recover] could not set a recovery PIN:', error.message)
    return { ok: false, reason: 'Could not set the recovery PIN.' }
  }
  return { ok: true, pin: chosen }
}

/** i•••••@cambridge.edu.gh — confirms the mailbox without publishing it. */
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return 'your corporate email'
  return `${email[0]}${'•'.repeat(5)}${email.slice(at)}`
}

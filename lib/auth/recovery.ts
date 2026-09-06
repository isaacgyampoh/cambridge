import 'server-only'
import { randomBytes, randomInt } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, verifyPIN, hashToken, generateOTP } from '@/lib/auth/pin'
import { generatePin, isValidPin, pinRejectionReason, OTP_LENGTH } from '@/lib/auth/pinPolicy'

/**
 * Account recovery.
 *
 * ── THE SHAPE, AND WHY ─────────────────────────────────────────────────────
 *
 *     recovery PIN  →  OTP to the registered corporate email  →  new PIN
 *
 * The recovery PIN proves nothing by itself. It selects an account and opens
 * the flow; the one-time code sent to that account's mailbox is what actually
 * authorises anything. So a four-digit recovery PIN is not a four-digit
 * password to the whole system — whoever holds it still cannot get in without
 * the mailbox, which is the same second factor normal sign-in uses.
 *
 * What is issued at the end of the OTP step is a RESET TOKEN, not a session.
 * It permits exactly one action, is single use, expires in fifteen minutes,
 * and the proxy has never heard of it.
 *
 * The recovery PIN is stored separately from the account PIN and is not
 * touched when the account PIN changes, so recovery works again next time.
 * Making it single-shot is how the super admin came to be locked out twice.
 */

const RESET_TOKEN_MINUTES = 15
export const OTP_MINUTES = 10

export type RecoveryStart =
  | {
      ok: true
      userId: string
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
      code: string
      /** Where to send it, and who to address. Never returned over HTTP. */
      email: string
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
    .select('id, full_name, email, recovery_pin_hash, is_active')
    .eq('is_active', true)
    .not('recovery_pin_hash', 'is', null)

  if (error) {
    console.error('[recover] could not load accounts:', error.message)
    return { ok: false, reason: 'Recovery is unavailable right now. Please try again.', status: 500 }
  }

  const matches: Array<{ id: string; email: string | null; fullName: string }> = []
  for (const row of rows || []) {
    const { ok } = await verifyPIN(pin, row.recovery_pin_hash as string)
    if (ok) matches.push({ id: row.id, email: row.email, fullName: row.full_name })
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
    emailHint: maskEmail(account.email),
    expiresInSeconds: OTP_MINUTES * 60,
    code,
    email: account.email,
    fullName: account.fullName,
  }
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

  const token = randomBytes(32).toString('hex')
  const { error: writeErr } = await sb.from('profiles').update({
    otp_code: null,
    otp_expires_at: null,
    otp_attempts: 0,
    reset_token_hash: hashToken(token),
    reset_token_expires_at: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000).toISOString(),
  }).eq('id', userId)

  if (writeErr) {
    console.error('[recover] could not issue the reset token:', writeErr.message)
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

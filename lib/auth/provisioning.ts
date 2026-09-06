import 'server-only'
import { randomBytes, randomInt } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, verifyPIN, hashToken } from '@/lib/auth/pin'
import { generatePin } from '@/lib/auth/pinPolicy'
import { CONFIG } from '@/lib/config'

/**
 * First-run provisioning of the super admin, from a browser.
 *
 * ── WHY IT WORKS THE WAY IT DOES ───────────────────────────────────────────
 *
 * Provisioning must be authorised by SETUP_SECRET, which lives only in the
 * deployment environment. The person who owns the system cannot read it — it
 * is marked Sensitive precisely so nobody can — so they cannot present it in
 * a browser, and a setup page that asks for it is a page they can never use.
 *
 * So authorisation and use are separated in time. Someone holding the secret
 * OPENS a short, single-use window server-side; the setup page CLAIMS it,
 * once, with no secret at all. The window is the authorisation, carried
 * forward.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *
 * No public provisioning. With no open window the claim refuses, always.
 *
 * No accidental overwrite. A super admin who already holds a usable
 * credential is not replaced unless the window was opened asking for exactly
 * that — opening a window is not, by itself, permission to take over a
 * working account.
 *
 * No credential ever leaves this module except in the single response that
 * creates it. Nothing is logged, audited or stored in the clear.
 */

const WINDOW_MINUTES = 30

export type ProvisioningState = {
  /** A super admin profile exists at all. */
  superAdminExists: boolean
  /** …and holds a PIN, so somebody can in principle sign in. */
  hasSignInPin: boolean
  /** …and holds a recovery PIN, so they can recover themselves. */
  hasRecoveryPin: boolean
  /** Setup has something left to do. */
  provisioningIncomplete: boolean
  /** A window is open right now, so the setup page can act. */
  windowOpen: boolean
  /** Whether that window may replace a working credential. */
  windowAllowsReset: boolean
  /** Seconds until the open window lapses, or 0. */
  windowExpiresIn: number
}

/**
 * What setup should show, and what it may do.
 *
 * Every field is a fact about the SERVER's state. None of it is derived from
 * a secret, so it is safe to return to an anonymous browser — the setup page
 * needs to know whether there is anything to do before it offers to do it.
 */
export async function readProvisioningState(): Promise<ProvisioningState> {
  const sb = createServiceClient()

  const { data: admins } = await sb.from('profiles')
    .select('id, pin_hash, recovery_pin_hash')
    .eq('role', 'super_admin')
    .eq('is_active', true)

  const superAdminExists = (admins?.length || 0) > 0
  const hasSignInPin = (admins || []).some(a => Boolean(a.pin_hash))
  const hasRecoveryPin = (admins || []).some(a => Boolean(a.recovery_pin_hash))

  const { data: openWindow } = await sb.from('setup_windows')
    .select('expires_at, allow_reset')
    .is('claimed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    superAdminExists,
    hasSignInPin,
    hasRecoveryPin,
    /*
     * "Incomplete" means the owner cannot both get in AND get back in. An
     * account with a PIN nobody knows and no recovery PIN is, from the
     * owner's side, not provisioned.
     */
    provisioningIncomplete: !superAdminExists || !hasRecoveryPin,
    windowOpen: Boolean(openWindow),
    windowAllowsReset: Boolean(openWindow?.allow_reset),
    windowExpiresIn: openWindow
      ? Math.max(0, Math.floor((new Date(openWindow.expires_at).getTime() - Date.now()) / 1000))
      : 0,
  }
}

/**
 * Open a provisioning window. Requires SETUP_SECRET; the caller checks that.
 *
 * Any window already open is closed first, so there is never more than one
 * claimable at a time and re-opening cannot quietly widen an earlier, narrower
 * authorisation.
 */
export async function openProvisioningWindow(
  allowReset: boolean
): Promise<{ ok: true; expiresInSeconds: number } | { ok: false; reason: string }> {
  const sb = createServiceClient()

  const { error: closeErr } = await sb.from('setup_windows')
    .update({ claimed_at: new Date().toISOString(), outcome: 'superseded' })
    .is('claimed_at', null)
  if (closeErr) {
    console.error('[provisioning] could not close earlier windows:', closeErr.message)
    return { ok: false, reason: 'Could not open a setup window.' }
  }

  // The token is not handed to anybody. A window is identified by being the
  // one open row; the hash exists so a database dump cannot be replayed.
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + WINDOW_MINUTES * 60_000)

  const { error } = await sb.from('setup_windows').insert({
    token_hash: hashToken(token),
    purpose: 'provision',
    allow_reset: allowReset,
    expires_at: expiresAt.toISOString(),
  })

  if (error) {
    console.error('[provisioning] could not open a window:', error.message)
    return { ok: false, reason: 'Could not open a setup window.' }
  }

  return { ok: true, expiresInSeconds: WINDOW_MINUTES * 60 }
}

export type ProvisionResult =
  | { ok: true; signInPin: string; recoveryPin: string; email: string; reset: boolean }
  | { ok: false; reason: string; status: number }

/**
 * Claim the open window and provision the super admin.
 *
 * Atomic in the way that matters: the window is marked claimed FIRST, with a
 * condition that only one caller can satisfy. Two browsers pressing the button
 * together produce one provisioning, not two — and a second press cannot mint
 * a fresh set of credentials for an account somebody is already using.
 */
export async function claimProvisioning(ip: string): Promise<ProvisionResult> {
  const sb = createServiceClient()
  const now = new Date().toISOString()

  const { data: openWindow } = await sb.from('setup_windows')
    .select('id, allow_reset')
    .is('claimed_at', null)
    .gt('expires_at', now)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!openWindow) {
    return {
      ok: false,
      status: 403,
      reason: 'Setup is not open. An administrator must open a setup window first.',
    }
  }

  const state = await readProvisioningState()

  /*
   * A working super admin is not replaced by accident. Opening a window says
   * "provisioning may happen"; replacing a credential somebody is currently
   * using has to be asked for explicitly.
   */
  if (state.superAdminExists && state.hasSignInPin && state.hasRecoveryPin
      && !openWindow.allow_reset) {
    return {
      ok: false,
      status: 409,
      reason: 'A super admin is already fully provisioned. '
        + 'Use Forgot PIN on the sign-in screen, or open a setup window that permits a reset.',
    }
  }

  // Claim it before doing anything. The .is('claimed_at', null) condition is
  // what makes this a race nobody can win twice.
  const { data: claimed, error: claimErr } = await sb.from('setup_windows')
    .update({ claimed_at: now, claimed_ip: ip, outcome: 'provisioned' })
    .eq('id', openWindow.id)
    .is('claimed_at', null)
    .select('id')
    .maybeSingle()

  if (claimErr) {
    console.error('[provisioning] could not claim the window:', claimErr.message)
    return { ok: false, status: 500, reason: 'Setup could not be completed. Please try again.' }
  }
  if (!claimed) {
    return { ok: false, status: 409, reason: 'That setup window has already been used.' }
  }

  const signInPin = generatePin(randomInt)
  const recoveryPin = generatePin(randomInt)

  /*
   * The two must differ, and neither may collide with another active account.
   * Sign-in tries a PIN against every account, so a duplicate makes BOTH
   * unusable — and a recovery PIN equal to the sign-in PIN would blur the line
   * between recovering and signing in.
   */
  if (signInPin === recoveryPin) {
    return { ok: false, status: 500, reason: 'Setup could not be completed. Please try again.' }
  }

  const { data: others } = await sb.from('profiles')
    .select('id, pin_hash, role')
    .eq('is_active', true)
    .not('pin_hash', 'is', null)

  for (const other of others || []) {
    if (other.role === 'super_admin') continue
    const { ok } = await verifyPIN(signInPin, other.pin_hash as string)
    if (ok) {
      return { ok: false, status: 409, reason: 'Setup could not be completed. Please try again.' }
    }
  }

  const existing = (await sb.from('profiles')
    .select('id, email').eq('role', 'super_admin').eq('is_active', true)
    .limit(1).maybeSingle()).data

  const credentials = {
    pin_hash: await hashPIN(signInPin),
    recovery_pin_hash: await hashPIN(recoveryPin),
    pin_set_at: now,
    recovery_pin_set_at: now,
    // They chose neither PIN, so they are asked to choose their own at first
    // sign-in. The recovery PIN stays as issued — it is what gets them back.
    must_change_pin: true,
    login_attempts: 0,
    locked_until: null,
    is_active: true,
  }

  if (existing) {
    const { error } = await sb.from('profiles').update(credentials).eq('id', existing.id)
    if (error) {
      console.error('[provisioning] could not write credentials:', error.message)
      return { ok: false, status: 500, reason: 'Setup could not be completed. Please try again.' }
    }
    return {
      ok: true, signInPin, recoveryPin,
      email: existing.email || CONFIG.superAdminEmail,
      reset: true,
    }
  }

  /*
   * No super admin at all. Creating the profile needs an auth user to hang it
   * on, which is first-run's job — this path exists so the state is reported
   * honestly rather than half-provisioning something.
   */
  return {
    ok: false,
    status: 409,
    reason: 'No super admin account exists yet. Run the initial setup first.',
  }
}

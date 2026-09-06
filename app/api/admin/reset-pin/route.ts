import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, verifyPIN } from '@/lib/auth/pin'
import { setRecoveryPin } from '@/lib/auth/recovery'
import { recordAudit } from '@/lib/audit'
import { PIN_PATTERN, PIN_LENGTH, pinRejectionReason } from '@/lib/auth/pinPolicy'

export const runtime = 'nodejs'

/**
 * A super admin resets a colleague's PIN.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Staff forget PINs. Until now the only remedy was a developer editing the
 * database with a setup secret and a curl command, which is not a product and
 * does not scale past the first person it happens to.
 *
 * ── WHAT MAKES IT SAFE ─────────────────────────────────────────────────────
 *
 * The PIN arrives in plaintext over HTTPS and is hashed HERE, with the server
 * pepper, exactly like any other PIN. It is never hashed in the browser, never
 * stored in the clear, never returned in the response, and never written to
 * the audit record — the audit says a reset happened and who did it, which is
 * the part that matters for accountability.
 *
 * Only a super admin may call it, and a super admin may not reset another
 * super admin: a compromised administrator account should not be able to take
 * over its peers silently.
 */

const Body = z.object({
  userId: z.string().uuid(),
  newPin: z.string().regex(PIN_PATTERN, `A PIN must be exactly ${PIN_LENGTH} digits`),
  /** Also issue a recovery PIN, so this person can help themselves next time. */
  withRecoveryPin: z.boolean().optional().default(false),
})

export const POST = withGuard({ roles: ['super_admin'] }, async (req, { session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Enter a valid PIN.' },
      { status: 400 }
    )
  }
  const { userId, newPin, withRecoveryPin } = parsed.data

  const rejection = pinRejectionReason(newPin)
  if (rejection) return NextResponse.json({ error: rejection }, { status: 400 })

  const sb = createServiceClient()
  const { data: target, error: readErr } = await sb.from('profiles')
    .select('id, full_name, role, is_active').eq('id', userId).maybeSingle()

  if (readErr) {
    console.error('[reset-pin] could not read the account:', readErr.message)
    return NextResponse.json({ error: 'Could not load that account.' }, { status: 500 })
  }
  if (!target) return NextResponse.json({ error: 'That account does not exist.' }, { status: 404 })
  if (!target.is_active) {
    return NextResponse.json(
      { error: 'That account is inactive. Reactivate it before setting a PIN.' }, { status: 400 }
    )
  }
  if (target.role === 'super_admin' && target.id !== session.userId) {
    return NextResponse.json(
      { error: 'A super admin cannot reset another super admin\'s PIN.' }, { status: 403 }
    )
  }

  /*
   * PIN collision.
   *
   * Sign-in tries the submitted PIN against every active account, so two
   * people sharing one makes BOTH accounts unusable — the login returns 409
   * rather than guessing. Checked before writing, never after.
   */
  const { data: others } = await sb.from('profiles')
    .select('id, full_name, pin_hash')
    .eq('is_active', true).not('pin_hash', 'is', null).neq('id', userId)

  for (const other of others || []) {
    const { ok } = await verifyPIN(newPin, other.pin_hash as string)
    if (ok) {
      await recordAudit({
        actorId: session.userId, action: 'staff.pin_reset_refused_collision',
        resource: 'profiles', resourceId: userId, success: false, request: req,
        metadata: { reason: 'PIN already in use by another active account' },
      })
      return NextResponse.json(
        { error: 'That PIN is already in use by another account. Choose a different one.' },
        { status: 409 }
      )
    }
  }

  const { error: writeErr } = await sb.from('profiles').update({
    pin_hash: await hashPIN(newPin),
    pin_set_at: new Date().toISOString(),
    // They must choose their own at first sign-in; the administrator does not
    // get to keep knowing a colleague's PIN.
    must_change_pin: true,
    login_attempts: 0,
    locked_until: null,
  }).eq('id', userId)

  if (writeErr) {
    console.error('[reset-pin] could not set the PIN:', writeErr.message)
    return NextResponse.json({ error: 'Could not reset that PIN.' }, { status: 500 })
  }

  let recoveryPin: string | null = null
  if (withRecoveryPin) {
    const result = await setRecoveryPin(userId)
    if (result.ok) recoveryPin = result.pin
    else console.error('[reset-pin] could not set a recovery PIN:', result.reason)
  }

  await recordAudit({
    actorId: session.userId, action: 'staff.pin_reset',
    resource: 'profiles', resourceId: userId, success: true, request: req,
    // Who, by whom, and when. Never what.
    metadata: {
      target: target.full_name, targetRole: target.role,
      recoveryPinIssued: Boolean(recoveryPin),
    },
  })

  return NextResponse.json({
    success: true,
    mustChangePin: true,
    // Shown once so the administrator can pass it on; not stored anywhere.
    recoveryPin,
    message: `${target.full_name} can now sign in with that PIN and will be asked to choose their own.`,
  })
})

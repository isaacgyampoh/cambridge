import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, verifyPIN } from '@/lib/auth/pin'
import { setRecoveryPin } from '@/lib/auth/recovery'
import { recordAudit } from '@/lib/audit'
import { PIN_PATTERN, PIN_LENGTH, pinRejectionReason } from '@/lib/auth/pinPolicy'
import { deliverPinReset, deliverResetLink } from '@/lib/auth/otpDelivery'
import { startAdminReset, ADMIN_RESET_TOKEN_MINUTES } from '@/lib/auth/recovery'
import { publicUrl } from '@/lib/url'

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

/**
 * ── TWO WAYS TO RESET, AND WHY BOTH EXIST ──────────────────────────────────
 *
 * `link` (the default) sends a single-use, expiring link and changes nothing
 * on the account until the person uses it. No PIN travels anywhere.
 *
 * `manual_pin` is the old behaviour, kept deliberately rather than removed:
 * when somebody's phone is refusing our messages and there is no mailbox
 * configured — which is exactly the position this centre is in today — an
 * administrator still has to be able to set a PIN and read it out. It is no
 * longer the default, it says plainly that the PIN must be spoken rather than
 * forwarded, and it is recorded as the deliberate choice it is.
 *
 * `resend` re-sends the link for a reset already started. It mints no PIN and
 * no recovery PIN: retrying a message that did not arrive must not be a
 * second reset, or every failed text costs the person their credential again.
 */
const Body = z.object({
  userId: z.string().uuid(),
  mode: z.enum(['link', 'manual_pin', 'resend']).optional().default('link'),
  /** Only for manual_pin: the PIN the administrator will read out. */
  newPin: z.string().regex(PIN_PATTERN, `A PIN must be exactly ${PIN_LENGTH} digits`).optional(),
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
  const { userId, mode, withRecoveryPin } = parsed.data
  const newPin = parsed.data.newPin

  if (mode === 'manual_pin') {
    if (!newPin) {
      return NextResponse.json({ error: 'Choose the PIN you will read out to them.' }, { status: 400 })
    }
    const rejection = pinRejectionReason(newPin)
    if (rejection) return NextResponse.json({ error: rejection }, { status: 400 })
  }

  const sb = createServiceClient()
  const { data: target, error: readErr } = await sb.from('profiles')
    .select('id, full_name, role, is_active, phone, email').eq('id', userId).maybeSingle()

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
   * ── THE DEFAULT PATH: A LINK, NOT A CREDENTIAL ───────────────────────────
   *
   * Nothing about the account changes here. The old reset wrote a new PIN
   * immediately and texted it, so a message that never arrived — which is
   * what was happening — left somebody locked out of an account whose PIN
   * only the administrator knew. If this link never reaches them, they are
   * exactly where they were before it was pressed.
   */
  if (mode === 'link' || mode === 'resend') {
    const token = await startAdminReset(userId)
    if (!token) {
      return NextResponse.json({
        error: 'The reset could not be started. Nothing has changed on their account.',
      }, { status: 503 })
    }

    const link = publicUrl(`/reset?t=${token}`)
    const delivery = await deliverResetLink(target, link, ADMIN_RESET_TOKEN_MINUTES)

    await recordAudit({
      actorId: session.userId,
      action: mode === 'resend' ? 'staff.pin_reset_link_resent' : 'staff.pin_reset_link_sent',
      resource: 'profiles', resourceId: userId, success: true, request: req,
      /*
       * Who, by whom, and which channels took it. Never the token: an audit
       * record is readable, and a token in it would be the credential this
       * whole path exists to stop sending.
       */
      metadata: {
        target: target.full_name, targetRole: target.role,
        channels: delivery.outcomes.map(o => `${o.channel}:${o.accepted ? 'accepted' : 'failed'}`),
      },
    })

    return NextResponse.json({
      success: true,
      mode,
      /*
       * Said exactly: a provider ACCEPTED it. Whether a handset received it is
       * a different fact, and the delivery screen is where it is answered —
       * claiming delivery here is what left everybody believing a text had
       * gone out when the network had refused it.
       */
      anyAccepted: delivery.anyAccepted,
      channels: delivery.outcomes,
      expiresInMinutes: ADMIN_RESET_TOKEN_MINUTES,
      message: delivery.anyAccepted
        ? `${target.full_name} has been sent a link to choose a new PIN. It works once and expires in `
          + `${ADMIN_RESET_TOKEN_MINUTES} minutes. Their current PIN keeps working until they use it.`
        : `Nothing could be sent to ${target.full_name}, so their account is unchanged. `
          + 'Use "Set a PIN to read out" instead, or fix the details below and retry.',
    })
  }

  /*
   * Only the manual path reaches here, and it was refused above without a
   * PIN. Stated again rather than asserted, so the narrowing is a fact the
   * code checks and not a promise a later edit can quietly break.
   */
  if (!newPin) {
    return NextResponse.json({ error: 'Choose the PIN you will read out to them.' }, { status: 400 })
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

  /*
   * Tell them, rather than leaving the administrator to do it.
   *
   * A reset used to send nothing at all: the PIN was set and the colleague
   * found out when somebody remembered to tell them. The message carries the
   * PIN and the portal address together, so a person who has never signed in
   * has everything they need in one text.
   *
   * By SMS where there is a number, falling back to email. The recovery PIN
   * is NOT sent — it is shown to the administrator once, so a single
   * intercepted message cannot hand over both credentials at once.
   */
  const notice = await deliverPinReset(target, newPin)

  await recordAudit({
    actorId: session.userId, action: 'staff.pin_reset',
    resource: 'profiles', resourceId: userId, success: true, request: req,
    // Who, by whom, when, and whether they were told. Never what.
    metadata: {
      target: target.full_name, targetRole: target.role,
      recoveryPinIssued: Boolean(recoveryPin),
      notified: notice.sent, notifiedVia: notice.via,
      // Why it did not arrive, so the audit says more than "no".
      notDeliveredBecause: notice.sent ? null : notice.reason,
    },
  })

  return NextResponse.json({
    success: true,
    mustChangePin: true,
    // Shown once so the administrator can pass it on; not stored anywhere.
    recoveryPin,
    /*
     * Said plainly either way. An administrator who believes the PIN was sent
     * and is wrong will not make the phone call they would otherwise have
     * made, so a silent failure here is worse than no message at all.
     */
    notified: notice.sent,
    notifiedVia: notice.via,
    notifiedTo: notice.hint,
    message: notice.sent
      ? `${target.full_name} has been sent the new PIN ${
          notice.via === 'sms' ? 'by text' : 'by email'} (${notice.hint}). Read it out to them rather than `
        + 'forwarding the message, and they will be asked to choose their own at sign-in.'
      : `${target.full_name} can sign in with that PIN and will be asked to choose their own — `
        + `but the message could not be sent${notice.reason ? `, because ${notice.reason}` : ''}. `
        + 'Pass the PIN on yourself.',
  })
})

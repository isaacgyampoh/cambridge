import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { startRecovery } from '@/lib/auth/recovery'
import { sendOTPEmail } from '@/lib/integrations/email'
import { rateLimit, clientIp, retryMessage, isBlocked, recordFailure } from '@/lib/auth/rateLimit'
import { recordAudit } from '@/lib/audit'
import { PIN_PATTERN } from '@/lib/auth/pinPolicy'

export const runtime = 'nodejs'

/**
 * Step 1 of account recovery: recovery PIN in, code emailed out.
 *
 * Public by necessity — somebody who has forgotten their PIN cannot sign in to
 * ask for help. That makes it a guessing target, so it carries the same
 * ceilings as sign-in: a per-address budget and a global one, both checked
 * BEFORE any hash is computed so a flood cannot be turned into CPU load.
 *
 * The response never contains the code, and never says whether a recovery PIN
 * exists — a wrong PIN and an unknown one are answered identically.
 */

const Body = z.object({
  pin: z.string().regex(PIN_PATTERN, 'Enter your recovery PIN'),
})

const GLOBAL_KEY = 'recover:global'

/**
 * A separate, tighter ceiling for the path that has no second factor.
 *
 * Staff recovery is backed by a code to their mailbox, so a wrong recovery PIN
 * costs an attacker nothing they can use. The super admin has no mailbox, so
 * the recovery PIN IS the check — and ten thousand possibilities is not much
 * unless guessing is made expensive.
 *
 * Ten failures seals this path for an hour. An attacker gets ten guesses an
 * hour out of ten thousand; the owner, who knows the PIN, never sees it. The
 * seal is deliberately temporary rather than permanent: a lockout an attacker
 * can trigger and the owner cannot clear is a denial of service against the
 * one account that cannot be recovered any other way.
 */
const SELF_RECOVERY_KEY = 'recover:self-serve'
const SELF_RECOVERY_CEILING = 10
const SELF_RECOVERY_WINDOW = 60 * 60
const SELF_RECOVERY_BLOCK = 60 * 60

export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  /*
   * isBlocked returns an OBJECT, so `if (await isBlocked(...))` is always
   * true — which blocked recovery for everyone, permanently, the moment this
   * shipped. Read the field.
   */
  const globalLimit = await isBlocked(GLOBAL_KEY)
  if (globalLimit.blocked) {
    console.error('[recover] global recovery ceiling reached — paused for everyone.')
    return NextResponse.json(
      { error: `Recovery is temporarily unavailable. ${retryMessage(globalLimit.retryAfter)}` },
      { status: 429 }
    )
  }

  // Deliberately tighter than sign-in: recovery is rarer, and a burst of
  // attempts against it is far more likely to be an attack than a person.
  const limit = await rateLimit(`recover:${ip}`, 5, 15 * 60, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many recovery attempts. ${retryMessage(limit.retryAfter)}` },
      { status: 429 }
    )
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter your recovery PIN.' }, { status: 400 })
  }

  // The no-second-factor path is sealed separately, and checked before any
  // hash is computed so a flood cannot be turned into CPU load.
  const selfServe = await isBlocked(SELF_RECOVERY_KEY)
  if (selfServe.blocked) {
    console.error('[recover] self-serve recovery ceiling reached — sealed for now.')
    return NextResponse.json(
      { error: `Recovery is temporarily unavailable. ${retryMessage(selfServe.retryAfter)}` },
      { status: 429 }
    )
  }

  const result = await startRecovery(parsed.data.pin)

  if (!result.ok) {
    await recordFailure(GLOBAL_KEY, 60, 10 * 60, 5 * 60)
    await recordFailure(
      SELF_RECOVERY_KEY, SELF_RECOVERY_CEILING, SELF_RECOVERY_WINDOW, SELF_RECOVERY_BLOCK
    )
    await recordAudit({
      action: 'auth.recovery_denied', resource: 'profiles',
      success: false, request: req, metadata: { reason: result.reason },
    })
    return NextResponse.json({ error: result.reason }, { status: result.status })
  }

  /*
   * An account with no mailbox — the super admin — is already authorised at
   * this point: verifying the recovery PIN is the whole check, and what comes
   * back is permission to set a new PIN, not a session.
   */
  if (!result.needsCode) {
    await recordAudit({
      actorId: result.userId, action: 'auth.recovery_started',
      resource: 'profiles', resourceId: result.userId,
      success: true, request: req,
      metadata: { path: 'no_code_required' },
    })
    return NextResponse.json({
      success: true,
      userId: result.userId,
      needsCode: false,
      resetToken: result.resetToken,
      expiresInSeconds: result.expiresInSeconds,
    })
  }

  // Send it, then forget it. A failure here must not leave the caller thinking
  // a code is coming.
  if (!result.email || !result.code) {
    console.error('[recover] a code was expected but not produced for', result.userId)
    return NextResponse.json(
      { error: 'Recovery is unavailable right now. Please try again.' }, { status: 500 }
    )
  }

  try {
    await sendOTPEmail(result.email, result.fullName, result.code)
  } catch (e) {
    console.error('[recover] could not email the code:', e)
    return NextResponse.json(
      { error: 'We could not send your code. Please try again shortly.' },
      { status: 502 }
    )
  }

  await recordAudit({
    actorId: result.userId, action: 'auth.recovery_started',
    resource: 'profiles', resourceId: result.userId,
    success: true, request: req,
    metadata: { path: 'code_emailed' },
  })

  return NextResponse.json({
    success: true,
    userId: result.userId,
    needsCode: true,
    emailHint: result.emailHint,
    expiresInSeconds: result.expiresInSeconds,
  })
}

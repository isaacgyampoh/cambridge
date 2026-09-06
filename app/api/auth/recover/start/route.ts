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

export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  if (await isBlocked(GLOBAL_KEY)) {
    return NextResponse.json(
      { error: 'Recovery is temporarily unavailable. Please try again shortly.' },
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

  const result = await startRecovery(parsed.data.pin)

  if (!result.ok) {
    await recordFailure(GLOBAL_KEY, 60, 10 * 60, 5 * 60)
    await recordAudit({
      action: 'auth.recovery_denied', resource: 'profiles',
      success: false, request: req, metadata: { reason: result.reason },
    })
    return NextResponse.json({ error: result.reason }, { status: result.status })
  }

  // Send it, then forget it. A failure here must not leave the caller thinking
  // a code is coming.
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
  })

  return NextResponse.json({
    success: true,
    userId: result.userId,
    emailHint: result.emailHint,
    expiresInSeconds: result.expiresInSeconds,
  })
}

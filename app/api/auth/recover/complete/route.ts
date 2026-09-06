import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { completeRecovery } from '@/lib/auth/recovery'
import { rateLimit, clientIp, retryMessage } from '@/lib/auth/rateLimit'
import { recordAudit } from '@/lib/audit'
import { PIN_PATTERN, PIN_LENGTH } from '@/lib/auth/pinPolicy'

export const runtime = 'nodejs'

/**
 * Step 3: set the new PIN.
 *
 * Authorised solely by the single-use reset token from step 2, which is itself
 * only issued after a code sent to the account's registered mailbox. No
 * session is created here — the person is returned to sign-in and comes in
 * through the front door with their new PIN, so recovery never short-circuits
 * the OTP that normal authentication requires.
 */

const Body = z.object({
  resetToken: z.string().min(32).max(200),
  newPin: z.string().regex(PIN_PATTERN, `Your PIN must be exactly ${PIN_LENGTH} digits`),
})

export async function POST(req: NextRequest) {
  const limit = await rateLimit(`recover-complete:${clientIp(req)}`, 10, 15 * 60, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. ${retryMessage(limit.retryAfter)}` },
      { status: 429 }
    )
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Choose a new PIN.' },
      { status: 400 }
    )
  }

  const result = await completeRecovery(parsed.data.resetToken, parsed.data.newPin)

  if (!result.ok) {
    await recordAudit({
      action: 'auth.recovery_failed', resource: 'profiles',
      success: false, request: req, metadata: { reason: result.reason },
    })
    return NextResponse.json({ error: result.reason }, { status: result.status })
  }

  await recordAudit({
    actorId: result.userId, action: 'auth.recovery_completed',
    resource: 'profiles', resourceId: result.userId,
    success: true, request: req,
    // The PIN itself is never recorded anywhere, here or elsewhere.
    metadata: { via: 'recovery_pin_and_email_code' },
  })

  return NextResponse.json({ success: true })
}

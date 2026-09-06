import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyRecoveryCode } from '@/lib/auth/recovery'
import { rateLimit, clientIp, retryMessage } from '@/lib/auth/rateLimit'
import { recordAudit } from '@/lib/audit'
import { OTP_PATTERN } from '@/lib/auth/pinPolicy'

export const runtime = 'nodejs'

/**
 * Step 2: check the emailed code, hand back a single-use reset token.
 *
 * The token authorises exactly one action — setting a new PIN. It is not a
 * session and grants no access to anything, so returning it here does not put
 * the caller inside the application.
 */

const Body = z.object({
  userId: z.string().uuid(),
  code: z.string().regex(OTP_PATTERN, 'Enter the code from your email'),
})

export async function POST(req: NextRequest) {
  const limit = await rateLimit(`recover-verify:${clientIp(req)}`, 10, 15 * 60, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. ${retryMessage(limit.retryAfter)}` },
      { status: 429 }
    )
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Enter the code from your email.' },
      { status: 400 }
    )
  }

  const result = await verifyRecoveryCode(parsed.data.userId, parsed.data.code)

  if (!result.ok) {
    await recordAudit({
      actorId: parsed.data.userId, action: 'auth.recovery_code_rejected',
      resource: 'profiles', resourceId: parsed.data.userId,
      success: false, request: req, metadata: { reason: result.reason },
    })
    return NextResponse.json({ error: result.reason }, { status: result.status })
  }

  return NextResponse.json({ success: true, resetToken: result.resetToken })
}

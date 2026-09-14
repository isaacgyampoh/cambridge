import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { startSuperAdminRecoveryByEmail } from '@/lib/auth/recovery'
import { sendOTPEmail } from '@/lib/integrations/email'
import { rateLimit, clientIp, retryMessage } from '@/lib/auth/rateLimit'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * Step 1 of super admin recovery: recovery address in, code emailed out.
 *
 * ── WHY THIS ROUTE IS SEPARATE FROM /recover/start ─────────────────────────
 *
 * That one takes a recovery PIN and works out which account it belongs to.
 * This one takes an address and concerns exactly one account. Folding them
 * together would mean a single endpoint whose meaning depends on the shape of
 * its input, and whose rate limits would have to serve two different threat
 * models — guessing a four-digit PIN out of ten thousand, and guessing an
 * email address out of all of them.
 *
 * Everything after this step IS shared: /recover/verify checks the code and
 * mints the reset token, /recover/complete sets the new PIN. There is one OTP
 * implementation and one reset-token implementation, and this adds neither.
 *
 * ── WHAT IS NEVER REVEALED ─────────────────────────────────────────────────
 *
 * Whether the address was right. A mismatch returns the same shape, the same
 * status and a userId that simply belongs to no profile, so the next step
 * fails exactly as a wrong code would. The configured address is never in a
 * response, and the code is never in a response or a log.
 */

const Body = z.object({
  email: z.string().trim().min(3).max(320),
})

export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  /*
   * Tighter than staff recovery. The prize here is the account that can reach
   * every record in the system, and the check is a single address rather than
   * a PIN plus a mailbox — so guessing is made expensive.
   */
  const limit = await rateLimit(`recover-super:${ip}`, 5, 15 * 60, 30 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. ${retryMessage(limit.retryAfter)}` },
      { status: 429 },
    )
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter the recovery email address.' }, { status: 400 })
  }

  const result = await startSuperAdminRecoveryByEmail(parsed.data.email)

  if (!result.ok) {
    // Configuration and outage only. Never "that address is wrong".
    return NextResponse.json({ error: result.reason }, { status: result.status })
  }

  /*
   * A code is present only when the address actually matched. When it did
   * not, there is nothing to send and nothing to say — the response below is
   * identical either way.
   */
  if (result.code && result.email) {
    try {
      await sendOTPEmail(result.email, result.fullName || 'there', result.code)
      await recordAudit({
        actorId: result.userId, action: 'auth.super_admin_recovery_code_sent',
        resource: 'profiles', resourceId: result.userId, success: true, request: req,
        // Never the address, never the code.
        metadata: { path: 'email' },
      })
    } catch (e) {
      console.error('[recover/super-admin] could not send the code:', e)
      return NextResponse.json({
        error: 'We could not send the code. Please try again in a moment.',
      }, { status: 502 })
    }
  } else {
    await recordAudit({
      action: 'auth.super_admin_recovery_denied',
      resource: 'profiles', success: false, request: req,
      metadata: { reason: 'address_did_not_match' },
    })
  }

  return NextResponse.json({
    success: true,
    userId: result.userId,
    expiresInSeconds: result.expiresInSeconds,
  })
}

import { OTP_MINUTES } from '@/lib/auth/otpPolicy'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashToken, generateOTP } from '@/lib/auth/pin'
import { rateLimit, clientIp, retryMessage } from '@/lib/auth/rateLimit'
import { sendOTPEmail } from '@/lib/integrations/email'
import { recordAudit } from '@/lib/audit'
import { SECRETS } from '@/lib/config.server'
import { z } from 'zod'
import { lookup, unavailable } from '@/lib/db/lookup'

export const runtime = 'nodejs'



const Body = z.object({
  userId: z.string().uuid(),
})

/**
 * Re-send the sign-in code.
 *
 * Previously "resend" simply threw the user back to the PIN screen, because
 * the PIN is not kept anywhere after step one. That works, but it asks someone
 * whose email was slow to re-enter their PIN, which reads as though the first
 * attempt failed.
 *
 * This issues a fresh code for an account that is already mid-sign-in. It is
 * deliberately narrow:
 *
 *   - It only ever sends to the address already on the account. The caller
 *     supplies an id, never an address, so this cannot be used to mail an
 *     arbitrary recipient.
 *   - It only works while an unexpired code is outstanding, so it cannot be
 *     used to start a sign-in without knowing the PIN. Someone guessing user
 *     ids gets the same refusal as someone with a stale screen.
 *   - It is rate limited per account and per IP, so it cannot be used to spam
 *     a member of staff's inbox.
 *
 * Issuing a new code invalidates the previous one: the row holds a single
 * hash, so the old code stops working the moment this succeeds.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please start sign-in again.' }, { status: 400 })
  }
  const { userId } = parsed.data
  const ip = clientIp(req)

  const ipLimit = await rateLimit(`otp-resend:ip:${ip}`, 10, 15 * 60, 15 * 60)
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: `Too many requests from this connection. ${retryMessage(ipLimit.retryAfter)}` },
      { status: 429 }
    )
  }

  // Three resends per account per fifteen minutes: enough for a slow mail
  // server, not enough to fill an inbox.
  const userLimit = await rateLimit(`otp-resend:user:${userId}`, 3, 15 * 60, 15 * 60)
  if (!userLimit.allowed) {
    return NextResponse.json(
      { error: `You have asked for several codes already. ${retryMessage(userLimit.retryAfter)}` },
      { status: 429 }
    )
  }

  if (!SECRETS.otpEnabled) {
    return NextResponse.json({ error: 'Sign-in codes are not enabled.' }, { status: 400 })
  }

  const sb = createServiceClient()
  const { row: profile, failed } = await lookup(
    sb.from('profiles')
      .select('id, full_name, email, otp_expires_at')
      .eq('id', userId).eq('is_active', true).maybeSingle(),
  )

  // Same refusal whether the account is unknown, inactive, has no address, or
  // is simply not mid-sign-in — none of that should be discoverable here.
  const STALE = { error: 'That sign-in has expired. Please enter your PIN again.' }

  /*
   * A failed read is NOT a stale sign-in, and saying it is creates a loop
   * with no way out: the person is told to enter their PIN again, does, and
   * is told the same thing, for as long as the read keeps failing.
   *
   * 503 gives nothing away that STALE was protecting — it is the same answer
   * for every account, including ones that do not exist — and it is the only
   * one of the two that tells the person something true.
   */
  if (failed) return unavailable('[auth/resend-otp]', failed, 'your sign-in')
  if (!profile?.email) return NextResponse.json(STALE, { status: 401 })
  if (!profile.otp_expires_at || new Date(profile.otp_expires_at) < new Date()) {
    return NextResponse.json(STALE, { status: 401 })
  }

  const code = generateOTP(6)
  const { error: storeErr } = await sb.from('profiles').update({
    otp_code: hashToken(code),
    otp_expires_at: new Date(Date.now() + OTP_MINUTES * 60_000).toISOString(),
    otp_attempts: 0,
  }).eq('id', userId)

  if (storeErr) {
    console.error('[resend-otp] could not store the code:', storeErr.message)
    return NextResponse.json({ error: 'Could not send a new code. Please try again.' }, { status: 500 })
  }

  const sent = await sendOTPEmail(profile.email, profile.full_name || '', code)
  if (!sent) {
    await recordAudit({
      actorId: userId, action: 'auth.otp_resend_failed',
      resource: 'profiles', resourceId: userId, success: false, request: req,
    })
    return NextResponse.json(
      { error: 'We could not email your code. Please try again shortly.' },
      { status: 502 }
    )
  }

  await recordAudit({
    actorId: userId, action: 'auth.otp_resent',
    resource: 'profiles', resourceId: userId, success: true, request: req,
  })

  return NextResponse.json({ success: true, expiresInSeconds: OTP_MINUTES * 60 })
}

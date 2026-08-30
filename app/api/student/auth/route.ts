import { NextRequest, NextResponse } from 'next/server'
import {
  redeemToken, endStudentSession, STUDENT_COOKIE, STUDENT_COOKIE_OPTIONS,
} from '@/lib/student/auth'
import { rateLimit, clientIp, retryMessage } from '@/lib/auth/rateLimit'

export const runtime = 'nodejs'

/**
 * Exchange the one-time sign-in link for a session cookie.
 *
 * The token is genuinely single-use now: redeemToken claims it with a
 * conditional UPDATE on `token_used = false`, so a link that has already been
 * redeemed — forwarded on WhatsApp, left in a shared handset, recovered from a
 * backup — returns nothing. Previously the flag was written but never read, so
 * a link stayed usable for its full fourteen days and each redemption minted a
 * fresh ninety-day session.
 */
export async function POST(req: NextRequest) {
  // Tokens are 24 random bytes, so guessing is not the threat; this simply
  // stops an automated sweep of harvested links.
  const limit = await rateLimit(`student-auth:${clientIp(req)}`, 20, 15 * 60, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many sign-in attempts. ${retryMessage(limit.retryAfter)}` },
      { status: 429 }
    )
  }

  const { token } = await req.json().catch(() => ({}))
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'That sign-in link is not valid.' }, { status: 400 })
  }

  const result = await redeemToken(token)
  if (!result) {
    return NextResponse.json(
      { error: 'This sign-in link has already been used or has expired. Please request a new one.' },
      { status: 401 }
    )
  }

  const res = NextResponse.json({ success: true })
  res.cookies.set(STUDENT_COOKIE, result.session_token, STUDENT_COOKIE_OPTIONS)
  return res
}

/** Sign out: end the session server-side, not just in the browser. */
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(STUDENT_COOKIE)?.value
  await endStudentSession(token)

  const res = NextResponse.json({ success: true })
  res.cookies.set(STUDENT_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}

import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, destroySession, verifySession } from '@/lib/auth/pin'
import { recordAudit } from '@/lib/audit'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value

  if (token) {
    // Resolve who this was before the row is removed, so the logout can be
    // attributed in the audit trail.
    const session = await verifySession(token)
    // destroySession hashes the token the same way createSession did — the
    // raw token is never what is stored, so deleting by the raw value (as the
    // previous version did) would have silently matched nothing once tokens
    // began to be stored hashed, leaving sessions alive after "logout".
    await destroySession(token)
    if (session.valid) {
      await recordAudit({
        actorId: session.userId,
        action: 'auth.logout',
        resource: 'pin_sessions',
        success: true,
        request: req,
      })
    }
  }

  const res = NextResponse.json({ success: true })
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}

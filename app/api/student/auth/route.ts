import { NextRequest, NextResponse } from 'next/server'
import { redeemToken, STUDENT_COOKIE } from '@/lib/student/auth'

export const runtime = 'nodejs'

/** Exchange the one-time link token for a 90-day session cookie. */
export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({}))
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const result = await redeemToken(token)
  if (!result) return NextResponse.json({ error: 'This link has expired. Please request a new one.' }, { status: 401 })

  const res = NextResponse.json({ success: true })
  res.cookies.set(STUDENT_COOKIE, result.session_token, {
    httpOnly: true, secure: true, sameSite: 'lax',
    path: '/', maxAge: 60 * 60 * 24 * 90,
  })
  return res
}

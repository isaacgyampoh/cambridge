import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ valid: false }, { status: 401 })

  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ valid: false }, { status: 401 })

  return NextResponse.json({
    valid: true,
    userId: session.userId,
    role: session.role,
    fullName: session.fullName,
    email: session.email,
  })
}

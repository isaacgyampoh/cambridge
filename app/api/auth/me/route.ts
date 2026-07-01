import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ valid: false }, { status: 401 })

  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ valid: false }, { status: 401 })

  // Heartbeat: mark this user as recently active (fire-and-forget)
  try {
    const sb = createServiceClient()
    sb.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', session.userId).then(() => {}, () => {})
  } catch {}

  return NextResponse.json({
    valid: true,
    userId: session.userId,
    role: session.role,
    fullName: session.fullName,
    email: session.email,
    phone: session.phone,
    portals: session.portals || null,
  })
}

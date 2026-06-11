import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { SESSION_COOKIE } from '@/lib/auth/pin'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value

  if (token) {
    const sb = createServiceClient()
    await sb.from('pin_sessions').delete().eq('session_token', token)
  }

  const res = NextResponse.json({ success: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}

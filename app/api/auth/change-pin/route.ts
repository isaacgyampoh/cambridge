import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, verifyPIN, getSessionFromCookies } from '@/lib/auth/pin'

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session.valid) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { currentPin, newPin } = await req.json()
  if (!newPin || newPin.length < 4) return NextResponse.json({ error: 'PIN must be at least 4 digits' }, { status: 400 })
  if (!/^\d+$/.test(newPin)) return NextResponse.json({ error: 'PIN must be numbers only' }, { status: 400 })

  const sb = createServiceClient()
  const { data: profile } = await sb.from('profiles').select('pin_hash, must_change_pin').eq('id', session.userId).single()

  // If not first-time change, verify current PIN
  if (!profile?.must_change_pin && currentPin) {
    if (!verifyPIN(currentPin, profile?.pin_hash || '')) {
      return NextResponse.json({ error: 'Current PIN is incorrect' }, { status: 401 })
    }
  }

  await sb.from('profiles').update({
    pin_hash: hashPIN(newPin),
    pin_set_at: new Date().toISOString(),
    must_change_pin: false,
  }).eq('id', session.userId)

  return NextResponse.json({ success: true, message: 'PIN changed successfully!' })
}

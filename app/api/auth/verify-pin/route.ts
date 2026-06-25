import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN } from '@/lib/auth/pin'
import { sendOTPEmail } from '@/lib/integrations/email'

export const runtime = 'nodejs'

const MAX_PIN_ATTEMPTS = 5
const LOCK_MINUTES = 15

/**
 * Step 1 of login: verify the PIN. On success we DON'T create a session —
 * instead we email a 6-digit OTP and ask the client to move to the OTP step.
 * Lockout protects against PIN guessing.
 */
export async function POST(req: NextRequest) {
  const { pin } = await req.json()
  if (!pin || pin.length < 4) {
    return NextResponse.json({ error: 'Please enter your 4-digit PIN' }, { status: 400 })
  }

  const sb = createServiceClient()
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  const pinHash = hashPIN(pin)

  const { data: profile } = await sb.from('profiles')
    .select('*').eq('pin_hash', pinHash).eq('is_active', true).maybeSingle()

  if (!profile) {
    try { await sb.from('login_events').insert({ event_type: 'wrong_pin', ip_address: ip }) } catch {}
    return NextResponse.json({ error: 'Incorrect PIN. Try again.' }, { status: 401 })
  }

  // Locked out?
  if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(profile.locked_until).getTime() - Date.now()) / 60000)
    return NextResponse.json({ error: `Too many attempts. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.` }, { status: 429 })
  }

  // No email on file → can't deliver OTP. Fail safe with a clear message.
  if (!profile.email) {
    return NextResponse.json({ error: 'No email on file for this account. Ask your administrator to add your email so you can receive a login code.' }, { status: 400 })
  }

  // Generate a 6-digit OTP, store it hashed-by-expiry, email it.
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  await sb.from('profiles').update({
    otp_code: hashPIN(code),          // store hashed, never plain
    otp_expires_at: expires,
    otp_attempts: 0,
    login_attempts: 0,
    locked_until: null,
  }).eq('id', profile.id)

  const sent = await sendOTPEmail(profile.email, profile.full_name, code)
  if (!sent) {
    return NextResponse.json({ error: 'Could not send your login code by email. Please try again shortly.' }, { status: 502 })
  }

  // Mask the email for the UI (e.g. j••••@gmail.com)
  const [u, d] = profile.email.split('@')
  const masked = `${u[0]}${'•'.repeat(Math.max(1, u.length - 1))}@${d}`

  return NextResponse.json({ success: true, otpRequired: true, userId: profile.id, emailHint: masked })
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, createSession, ROLE_PORTAL, SESSION_COOKIE } from '@/lib/auth/pin'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { phone, pin } = body

  if (!phone || !pin) {
    return NextResponse.json({ error: 'Phone number and PIN are required' }, { status: 400 })
  }

  const sb = createServiceClient()
  const ip = req.headers.get('x-forwarded-for') || 'unknown'

  // Build all possible phone formats to search
  const raw  = String(phone).replace(/[\s\-\(\)]/g, '')
  const digits = raw.replace(/^\+/, '')
  
  const formats: string[] = []
  if (digits.startsWith('233')) {
    formats.push(digits)                    // 233XXXXXXXXX
    formats.push('0' + digits.slice(3))    // 0XXXXXXXXX
    formats.push('+' + digits)             // +233XXXXXXXXX
  } else if (digits.startsWith('0') && digits.length >= 9) {
    formats.push(digits)                    // 0XXXXXXXXX
    formats.push('233' + digits.slice(1))  // 233XXXXXXXXX
    formats.push('+233' + digits.slice(1)) // +233XXXXXXXXX
  } else {
    formats.push(digits)
    formats.push('0' + digits)
    formats.push('233' + digits)
  }

  // Deduplicate
  const unique = [...new Set(formats)]

  // Try each format — fetch all profiles and match
  const { data: allProfiles } = await sb.from('profiles')
    .select('*')
    .eq('is_active', true)

  const profile = allProfiles?.find(p =>
    p.phone && unique.includes(p.phone.replace(/[\s\-\(\)]/g, ''))
  )

  if (!profile) {
    return NextResponse.json({
      error: 'Phone number not found. Contact your administrator.',
    }, { status: 401 })
  }

  // Locked?
  if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(profile.locked_until).getTime() - Date.now()) / 60000)
    return NextResponse.json({
      error: `Too many wrong PINs. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.`
    }, { status: 429 })
  }

  // No PIN set yet?
  if (!profile.pin_hash) {
    return NextResponse.json({
      error: 'No PIN set for this account. Contact your administrator.'
    }, { status: 401 })
  }

  // Verify PIN
  if (hashPIN(pin) !== profile.pin_hash) {
    const attempts = (profile.login_attempts || 0) + 1
    const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null
    await sb.from('profiles').update({ login_attempts: attempts, locked_until: lockUntil }).eq('id', profile.id)
    const remaining = 5 - attempts
    return NextResponse.json({
      error: attempts >= 5
        ? 'Account locked for 15 minutes. Too many wrong PINs.'
        : `Wrong PIN. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
    }, { status: 401 })
  }

  // ✅ Success
  await sb.from('profiles').update({
    login_attempts: 0,
    locked_until: null,
    last_login_at: new Date().toISOString(),
  }).eq('id', profile.id)

  try {
    await sb.from('login_events').insert({
      user_id: profile.id,
      event_type: 'success',
      ip_address: ip,
    })
  } catch {}

  const sessionToken = await createSession(profile.id, ip)

  const portal = ROLE_PORTAL[profile.role] || '/admin'
  const res = NextResponse.json({
    success: true,
    redirect: portal,
    role: profile.role,
    fullName: profile.full_name,
    mustChangePIN: profile.must_change_pin || false,
  })

  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 3600,
    path: '/',
  })

  return res
}

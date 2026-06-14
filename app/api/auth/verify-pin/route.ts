import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, createSession, ROLE_PORTAL, SESSION_COOKIE } from '@/lib/auth/pin'

export async function POST(req: NextRequest) {
 const { pin } = await req.json()

 if (!pin || pin.length < 4) {
 return NextResponse.json({ error: 'Please enter your 4-digit PIN' }, { status: 400 })
 }

 const sb = createServiceClient()
 const ip = req.headers.get('x-forwarded-for') || 'unknown'
 const pinHash = hashPIN(pin)

 // Find user by PIN hash directly
 const { data: profile } = await sb.from('profiles')
 .select('*')
 .eq('pin_hash', pinHash)
 .eq('is_active', true)
 .maybeSingle()

 if (!profile) {
 // Log failed attempt (no user_id since we don't know who)
 try { await sb.from('login_events').insert({ event_type: 'wrong_pin', ip_address: ip }) } catch {}
 return NextResponse.json({ error: 'Incorrect PIN. Try again.' }, { status: 401 })
 }

 // Check if locked out
 if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
 const mins = Math.ceil((new Date(profile.locked_until).getTime() - Date.now()) / 60000)
 return NextResponse.json({
 error: `Too many wrong PINs. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.`
 }, { status: 429 })
 }

 // Success — reset attempts
 await sb.from('profiles').update({
 login_attempts: 0,
 locked_until: null,
 last_login_at: new Date().toISOString(),
 }).eq('id', profile.id)

 try {
 await sb.from('login_events').insert({ user_id: profile.id, event_type: 'success', ip_address: ip })
 } catch {}

 const sessionToken = await createSession(profile.id, ip)

 const res = NextResponse.json({
 success: true,
 redirect: ROLE_PORTAL[profile.role] || '/admin',
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

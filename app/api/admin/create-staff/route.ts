import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, getSessionFromCookies } from '@/lib/auth/pin'

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session.valid || !['super_admin', 'project_manager'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { full_name, email, phone, role, initial_pin, department } = await req.json()

  if (!full_name?.trim() || !phone?.trim() || !role) {
    return NextResponse.json({ error: 'Full name, phone number and role are required' }, { status: 400 })
  }

  // Normalize phone to 233XXXXXXXXX
  const rawPhone = phone.trim().replace(/\s+/g, '')
  const phone233 = rawPhone.startsWith('0') ? '233' + rawPhone.slice(1)
    : rawPhone.startsWith('+') ? rawPhone.slice(1)
    : rawPhone

  // Generate PIN — last 4 digits of phone or custom
  const pin = initial_pin?.trim() || phone233.slice(-4)
  if (!/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be 4-6 digits' }, { status: 400 })
  }

  const sb = createServiceClient()

  // Check phone not already used
  const { data: existingPhone } = await sb.from('profiles')
    .select('id').eq('phone', phone233).maybeSingle()
  if (existingPhone) {
    return NextResponse.json({ error: 'This phone number is already registered' }, { status: 409 })
  }

  // Use provided email or generate a placeholder (needed for Supabase Auth)
  const authEmail = email?.trim() || `${phone233}@cambridge.staff`
  const randomPassword = 'CCE-' + Math.random().toString(36).slice(2, 10) + '!'

  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email: authEmail,
    password: randomPassword,
    email_confirm: true,
  })

  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })

  const userId = authData.user.id
  const marketerCode = role === 'marketing_officer'
    ? full_name.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6)
    : null

  const { error: profileErr } = await sb.from('profiles').insert({
    id: userId,
    full_name: full_name.trim(),
    email: email?.trim() || null,
    phone: phone233,
    role,
    department: department?.trim() || null,
    pin_hash: hashPIN(pin),
    pin_set_at: new Date().toISOString(),
    must_change_pin: true,
    marketer_code: marketerCode,
    is_active: true,
  })

  if (profileErr) {
    await sb.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: profileErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    userId,
    credentials: {
      phone: rawPhone,           // show the original format they typed
      initial_pin: pin,
      note: 'Staff logs in with phone number + PIN. They must change PIN on first login.',
    },
  })
}

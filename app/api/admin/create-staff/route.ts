import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, getSessionFromCookies } from '@/lib/auth/pin'

export async function POST(req: NextRequest) {
  // Verify caller is super admin or project manager
  const session = await getSessionFromCookies()
  if (!session.valid || !['super_admin', 'project_manager'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { full_name, email, phone, role, initial_pin, department } = await req.json()

  if (!full_name || !email || !role || !phone) {
    return NextResponse.json({ error: 'Name, email, phone and role are required' }, { status: 400 })
  }

  // Generate PIN — use provided or default to last 4 of phone
  const pin = initial_pin || phone.replace(/\D/g, '').slice(-4) || '1234'

  if (!/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be 4-6 digits' }, { status: 400 })
  }

  const sb = createServiceClient()

  // Check email not already used
  const { data: existing } = await sb.from('profiles').select('id').eq('email', email.toLowerCase()).maybeSingle()
  if (existing) return NextResponse.json({ error: 'Email already registered' }, { status: 409 })

  // Create Supabase auth user
  const randomPassword = 'CCE-' + Math.random().toString(36).slice(2, 10) + '!'
  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email: email.toLowerCase(),
    password: randomPassword,
    email_confirm: true,
  })

  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })

  const userId = authData.user.id
  const marketerCode = role === 'marketing_officer'
    ? full_name.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6)
    : null

  // Create profile with hashed PIN
  const { error: profileErr } = await sb.from('profiles').insert({
    id: userId,
    full_name,
    email: email.toLowerCase(),
    phone: phone.replace(/\s+/g, '').replace(/^0/, '233'),
    role,
    department: department || null,
    pin_hash: hashPIN(pin),
    pin_set_at: new Date().toISOString(),
    must_change_pin: true, // force change on first login
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
    message: `Account created for ${full_name}`,
    credentials: {
      email: email.toLowerCase(),
      initial_pin: pin,
      note: 'Staff must change their PIN on first login',
    },
  })
}

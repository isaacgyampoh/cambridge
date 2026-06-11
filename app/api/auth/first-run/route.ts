import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN } from '@/lib/auth/pin'

// This endpoint sets up the super admin account on first run
// Call: GET /api/auth/first-run?secret=cce-setup-2024
// Only works if no super admin exists yet — completely safe to expose

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')

  if (secret !== (process.env.SETUP_SECRET || 'cce-setup-2024')) {
    return NextResponse.json({ error: 'Invalid setup secret' }, { status: 401 })
  }

  const sb = createServiceClient()

  // Check if super admin already exists
  const { data: existing } = await sb.from('profiles')
    .select('id').eq('role', 'super_admin').limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({
      success: false,
      message: 'Super admin already exists. Use staff management to change PIN.',
    })
  }

  // Create Supabase auth user for super admin
  const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@cambridge.edu.gh'
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD || 'CCE-Admin-2024!'

  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  })

  if (authErr && !authErr.message.includes('already')) {
    return NextResponse.json({ error: authErr.message }, { status: 500 })
  }

  const userId = authData?.user?.id

  if (!userId) {
    // Try to find existing auth user
    const { data: users } = await sb.auth.admin.listUsers()
    const existing = users?.users?.find((u: any) => u.email === adminEmail)
    if (!existing) return NextResponse.json({ error: 'Could not create auth user' }, { status: 500 })

    // Just update their profile
    await sb.from('profiles').upsert({
      id: existing.id,
      full_name: 'Super Admin',
      email: adminEmail,
      phone: null,
      role: 'super_admin',
      pin_hash: hashPIN('1024'),
      must_change_pin: true,
      is_active: true,
      marketer_code: null,
    }, { onConflict: 'id' })

    return NextResponse.json({
      success: true,
      message: 'Super admin profile updated.',
      login: { email: adminEmail, pin: '1024' },
      warning: 'Change your PIN immediately after first login!',
    })
  }

  // Create profile
  const { error: profileErr } = await sb.from('profiles').insert({
    id: userId,
    full_name: 'Super Admin',
    email: adminEmail,
    phone: null,
    role: 'super_admin',
    pin_hash: hashPIN('1024'),
    must_change_pin: true,
    is_active: true,
  })

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    message: 'Super admin created successfully!',
    login: {
      url: '/login',
      email: adminEmail,
      pin: '1024',
    },
    warning: '⚠️ Change your PIN immediately after first login via Staff Management!',
  })
}

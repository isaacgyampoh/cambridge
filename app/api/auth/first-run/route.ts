import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN } from '@/lib/auth/pin'
import { CONFIG } from '@/lib/config'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('secret') !== CONFIG.setupSecret) {
    return NextResponse.json({ error: 'Invalid setup secret' }, { status: 401 })
  }

  const sb = createServiceClient()

  // Check if super admin already exists
  const { data: existing } = await sb.from('profiles')
    .select('id, phone, full_name')
    .eq('role', 'super_admin')
    .limit(1)

  if (existing?.length) {
    return NextResponse.json({
      already_exists: true,
      message: 'Super admin already exists.',
      login: {
        phone: existing[0].phone?.replace(/^233/, '0') || '0201024000',
        pin: '1024 (if not changed yet)',
      },
    })
  }

  // Create Supabase auth user
  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email: CONFIG.superAdminEmail,
    password: CONFIG.superAdminPassword,
    email_confirm: true,
  })

  let userId = authData?.user?.id

  if (authErr?.message?.includes('already')) {
    // User exists in auth but no profile — get their ID
    const { data: users } = await sb.auth.admin.listUsers()
    userId = users?.users?.find((u: any) => u.email === CONFIG.superAdminEmail)?.id
  } else if (authErr) {
    return NextResponse.json({ error: authErr.message }, { status: 500 })
  }

  if (!userId) return NextResponse.json({ error: 'Could not get auth user ID' }, { status: 500 })

  // Insert profile — phone stored as 233XXXXXXXXX
  const { error: profileErr } = await sb.from('profiles').upsert({
    id: userId,
    full_name: 'Super Admin',
    email: CONFIG.superAdminEmail,
    phone: '233201024000',
    role: 'super_admin',
    pin_hash: hashPIN('1024'),
    must_change_pin: true,
    is_active: true,
  }, { onConflict: 'id' })

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message, hint: 'Make sure you have run FULL-SCHEMA.sql in Supabase first!' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    message: '✅ Super admin created successfully!',
    login: {
      url: 'https://cambridge-mu.vercel.app/login',
      phone: '0201024000',
      pin: '1024',
      note: 'You will be forced to set a new PIN on first login',
    },
  })
}

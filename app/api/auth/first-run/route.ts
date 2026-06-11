import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN } from '@/lib/auth/pin'
import { CONFIG } from '@/lib/config'

// One-time setup — creates super admin
// GET /api/auth/first-run?secret=cce-setup-2024
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('secret') !== CONFIG.setupSecret) {
    return NextResponse.json({ error: 'Invalid setup secret' }, { status: 401 })
  }

  const sb = createServiceClient()

  // Check if super admin already exists
  const { data: existing } = await sb.from('profiles').select('id, phone').eq('role', 'super_admin').limit(1)
  if (existing?.length) {
    return NextResponse.json({
      success: false,
      message: 'Super admin already exists.',
      login: { phone: existing[0].phone || '0201024000', pin: '1024 (if unchanged)' },
    })
  }

  // Create Supabase auth user for super admin
  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email: CONFIG.superAdminEmail,
    password: CONFIG.superAdminPassword,
    email_confirm: true,
  })

  if (authErr && !authErr.message.includes('already')) {
    return NextResponse.json({ error: authErr.message }, { status: 500 })
  }

  const userId = authData?.user?.id || (await sb.auth.admin.listUsers())
    .data?.users?.find((u: any) => u.email === CONFIG.superAdminEmail)?.id

  if (!userId) return NextResponse.json({ error: 'Could not create auth user' }, { status: 500 })

  // Super admin phone — used to log in
  const adminPhone = '0201024000' // default phone for super admin login

  await sb.from('profiles').upsert({
    id: userId,
    full_name: 'Super Admin',
    email: CONFIG.superAdminEmail,
    phone: '233201024000', // stored as 233 format
    role: 'super_admin',
    pin_hash: hashPIN('1024'),
    must_change_pin: true,
    is_active: true,
  }, { onConflict: 'id' })

  return NextResponse.json({
    success: true,
    message: '✅ Super admin created!',
    login: {
      url: '/login',
      phone: adminPhone,
      pin: '1024',
      note: 'You will be forced to set a new PIN on first login',
    },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { full_name, email, phone, role, password } = await req.json()

  if (!full_name || !email || !password || !role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const sb = createServiceClient()

  // Create auth user
  const { data: authData, error: authError } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  const userId = authData.user.id

  // Generate marketer code
  const marketerCode = full_name.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6)

  // Create profile
  const { error: profileError } = await sb.from('profiles').insert({
    id: userId,
    full_name,
    email,
    phone: phone || null,
    role,
    marketer_code: role === 'marketing_officer' ? marketerCode : null,
    is_active: true,
  })

  if (profileError) {
    // Rollback auth user
    await sb.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, userId })
}

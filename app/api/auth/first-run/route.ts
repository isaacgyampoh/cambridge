import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, generateOTP } from '@/lib/auth/pin'
import { recordAudit } from '@/lib/audit'
import { CONFIG } from '@/lib/config'
import { SECRETS } from '@/lib/config.server'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'

/**
 * One-time bootstrap: create (or recover) the super-admin account.
 *
 * The previous version hardcoded the PIN as '1024' and returned it in the JSON
 * response. Anyone who learned the setup secret — which was itself a literal
 * in the repository AND shipped to the browser — could reset the super admin
 * to a known PIN. Now the PIN is generated randomly and shown exactly once, in
 * the response to the caller who already proved they hold the setup secret.
 */
export async function GET(req: NextRequest) {
  const supplied = new URL(req.url).searchParams.get('secret') || ''
  const expected = SECRETS.setupSecret

  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await recordAudit({
      action: 'setup.first_run_denied', resource: 'profiles', success: false, request: req,
    })
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 })
  }

  const sb = createServiceClient()
  // A random 8-digit PIN, shown once. Forced to be changed at first sign-in.
  const initialPin = generateOTP(8)
  const pinHash = await hashPIN(initialPin)

  let userId: string | null = null
  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email: CONFIG.superAdminEmail,
    password: generateOTP(8) + '-' + generateOTP(8),  // unused by PIN login; never returned
    email_confirm: true,
  })

  if (authErr?.message?.includes('already')) {
    const { data: users } = await sb.auth.admin.listUsers()
    userId = users?.users?.find(u => u.email === CONFIG.superAdminEmail)?.id || null
  } else if (authErr) {
    console.error('[first-run] auth user creation failed:', authErr.message)
    return NextResponse.json(
      { error: 'Could not create the administrator account. Check the server logs.' },
      { status: 500 }
    )
  } else {
    userId = authData?.user?.id || null
  }

  if (!userId) {
    return NextResponse.json({
      error: 'Could not determine the administrator user id.',
      hint: 'Run the schema in the Supabase SQL editor first, then call this again.',
    }, { status: 500 })
  }

  const { data: existing } = await sb.from('profiles')
    .select('id, phone, email').eq('id', userId).maybeSingle()

  if (existing) {
    await sb.from('profiles').update({
      pin_hash: pinHash,
      must_change_pin: true,
      is_active: true,
      locked_until: null,
      login_attempts: 0,
    }).eq('id', userId)

    await recordAudit({
      actorId: userId, action: 'setup.super_admin_pin_reset',
      resource: 'profiles', resourceId: userId, success: true, request: req,
    })

    return NextResponse.json({
      success: true,
      message: 'Super admin PIN has been reset. This PIN is shown once — save it now.',
      signIn: {
        identifier: existing.email || CONFIG.superAdminEmail,
        pin: initialPin,
        note: 'You will be required to choose a new PIN at first sign-in.',
      },
    })
  }

  const { error: profileErr } = await sb.from('profiles').insert({
    id: userId,
    full_name: 'Super Admin',
    email: CONFIG.superAdminEmail,
    phone: '233201024000',
    role: 'super_admin',
    pin_hash: pinHash,
    must_change_pin: true,
    is_active: true,
    login_attempts: 0,
  })

  if (profileErr) {
    console.error('[first-run] profile insert failed:', profileErr.message)
    return NextResponse.json({
      error: 'Could not create the administrator profile.',
      hint: 'If the profiles table does not exist yet, run the schema in the Supabase SQL editor first.',
    }, { status: 500 })
  }

  await recordAudit({
    actorId: userId, action: 'setup.super_admin_created',
    resource: 'profiles', resourceId: userId, success: true, request: req,
  })

  return NextResponse.json({
    success: true,
    message: 'Super admin created. This PIN is shown once — save it now.',
    signIn: {
      identifier: CONFIG.superAdminEmail,
      pin: initialPin,
      note: 'You will be required to choose a new PIN at first sign-in.',
    },
  })
}

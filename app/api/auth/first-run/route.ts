import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, generateOTP } from '@/lib/auth/pin'
import { generatePin, PIN_LENGTH } from '@/lib/auth/pinPolicy'
import { setRecoveryPin } from '@/lib/auth/recovery'
import { randomInt } from 'crypto'
import { recordAudit } from '@/lib/audit'
import { CONFIG } from '@/lib/config'
import { describeSetupAuth } from '@/lib/auth/guard'

export const runtime = 'nodejs'

/**
 * One-time bootstrap: create (or recover) the super-admin account.
 *
 * Issues a FOUR-digit sign-in PIN and a FOUR-digit recovery PIN, both shown
 * once. It previously issued an eight-digit PIN, which the four-box sign-in
 * form could not accept — so this route had never produced a usable
 * credential.
 *
 * The previous version hardcoded the PIN as '1024' and returned it in the JSON
 * response. Anyone who learned the setup secret — which was itself a literal
 * in the repository AND shipped to the browser — could reset the super admin
 * to a known PIN. Now the PIN is generated randomly and shown exactly once, in
 * the response to the caller who already proved they hold the setup secret.
 */
export async function GET(req: NextRequest) {
  /*
   * Authorisation, via the shared setup guard.
   *
   * This route previously compared the secret itself, reading ONLY
   * `?secret=` from the query string. That is the narrowest of the three
   * places lib/auth/guard.ts already accepts, and the one that mangles the
   * value: a query string is URL-decoded before the server sees it, so a
   * secret containing '+' arrives with a space in its place, '&' truncates
   * the parameter, and '%' begins an escape sequence. A base64 secret with a
   * '+' in it could therefore never authenticate, and the response — a bare
   * "Not authorised." — gave no way to tell that from a wrong secret.
   */
  const attempt = describeSetupAuth(req)

  if (!attempt.ok) {
    /*
     * Enough to diagnose, nothing to disclose.
     *
     * `lengthMatch` is one bit and it is the decisive one: a value mangled in
     * transit or carrying a stray newline changes length, a genuinely wrong
     * secret usually does not. The secret, and anything derived from it, is
     * never logged.
     */
    console.error('[first-run] denied.',
      'SETUP_SECRET configured:', attempt.configured,
      '| secret read from:', attempt.where,
      '| same length as expected:', attempt.lengthMatch,
      attempt.where === 'query:secret'
        ? '| NOTE: a query string is URL-decoded — "+" becomes a space. Send it as an Authorization: Bearer header instead.'
        : '')

    await recordAudit({
      action: 'setup.first_run_denied', resource: 'profiles', success: false, request: req,
      metadata: {
        secretConfigured: attempt.configured,
        suppliedVia: attempt.where,
        lengthMatch: attempt.lengthMatch,
      },
    })

    return NextResponse.json({
      error: 'Not authorised.',
      // Safe to return: says whether the SERVER is configured, and where it
      // looked. Neither depends on the secret's value.
      setupSecretConfigured: attempt.configured,
      suppliedVia: attempt.where,
      hint: !attempt.configured
        ? 'SETUP_SECRET is not set in this deployment. Add it in Vercel and redeploy.'
        : attempt.where === 'none'
          ? 'No secret was supplied. Send it as an Authorization: Bearer header, or as ?secret=.'
          : 'The secret did not match. If it contains + & or %, send it as an Authorization: Bearer header — a query string decodes those characters before the server sees them.',
    }, { status: 401 })
  }

  console.info('[first-run] authorised. Secret read from:', attempt.where)

  const sb = createServiceClient()
  /*
   * A FOUR-digit PIN, because that is the product's PIN policy.
   *
   * This issued an eight-digit PIN, which the sign-in form — four boxes —
   * could not accept. Account recovery therefore never worked at all: the
   * route returned a credential nobody could type.
   */
  const initialPin = generatePin(randomInt)
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

    /*
     * A recovery PIN as well as a sign-in PIN.
     *
     * Without one, forgetting this PIN means another setup-secret round trip —
     * which is what happened last time. With one, the account can be recovered
     * from the sign-in screen by anyone holding the recovery PIN AND the
     * corporate mailbox.
     */
    const recovery = await setRecoveryPin(userId)

    return NextResponse.json({
      success: true,
      message: 'Super admin PIN has been reset. Both PINs are shown once — save them now.',
      recoveryPin: recovery.ok ? recovery.pin : null,
      recoveryNote: recovery.ok
        ? 'Keep this somewhere safe. It is what lets you reset your PIN yourself if you forget it — you will also need a code sent to the account email.'
        : 'A recovery PIN could not be set. Set one from the Staff page once you are signed in.',
      signIn: {
        identifier: existing.email || CONFIG.superAdminEmail,
        pin: initialPin,
        note: `This is a ${PIN_LENGTH}-digit PIN. You will be asked to choose a new one at first sign-in.`,
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

  const recovery = await setRecoveryPin(userId)

  return NextResponse.json({
    success: true,
    message: 'Super admin created. Both PINs are shown once — save them now.',
    recoveryPin: recovery.ok ? recovery.pin : null,
    recoveryNote: recovery.ok
      ? 'Keep this somewhere safe. It is what lets you reset your PIN yourself if you forget it.'
      : 'A recovery PIN could not be set. Set one from the Staff page once you are signed in.',
    signIn: {
      identifier: CONFIG.superAdminEmail,
      pin: initialPin,
      note: `This is a ${PIN_LENGTH}-digit PIN. You will be asked to choose a new one at first sign-in.`,
    },
  })
}

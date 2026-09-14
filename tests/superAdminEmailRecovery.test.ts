import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * A WAY BACK IN THAT THE OWNER CAN ACTUALLY USE.
 *
 * ── WHY THIS WAS ADDED ─────────────────────────────────────────────────────
 *
 * The super admin's self-service route is recovery PIN -> new PIN, with no
 * code, because they have no corporate mailbox. That works only for somebody
 * who has the recovery PIN. With both PINs gone the only way back was a
 * SETUP_SECRET window — a link, a query string, and an encoding fault — at the
 * exact moment the owner is locked out and least able to debug anything.
 *
 * So: one address, configured on the server, whose only purpose is receiving a
 * code. It is NOT a login identity. Normal sign-in is unchanged — PIN only,
 * no OTP — and nothing about the account becomes email-dependent.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const recovery = codeOf('lib/auth/recovery.ts')
const route = codeOf('app/api/auth/recover/super-admin/route.ts')
const form = codeOf('app/(auth)/login/LoginForm.tsx')

describe('the recovery address never leaks', () => {
  test('it is server-side only', () => {
    const config = codeOf('lib/config.server.ts')
    assert.match(config, /superAdminRecoveryEmail\(\) \{ return optional\('SUPER_ADMIN_RECOVERY_EMAIL'\) \}/)
    // NEXT_PUBLIC_ would put it in the browser bundle.
    assert.ok(!/NEXT_PUBLIC_SUPER_ADMIN/.test(config))
    assert.ok(!/SUPER_ADMIN_RECOVERY_EMAIL/.test(codeOf('lib/config.ts')),
      'The public config must not carry it.')
  })

  test('no response contains it', () => {
    const responses = route.match(/NextResponse\.json\([\s\S]*?\)/g) || []
    for (const r of responses) {
      assert.ok(!/result\.email|configured|recoveryEmail/.test(r),
        `a response may carry the address: ${r.slice(0, 90)}`)
    }
  })

  test('nor any log line or audit entry', () => {
    for (const [name, src] of [['route', route], ['recovery', recovery]] as const) {
      for (const line of src.split('\n').filter(l => /console\.|metadata:/.test(l))) {
        assert.ok(!/result\.email|configured|supplied\b/.test(line),
          `${name} may emit the address: ${line.trim().slice(0, 90)}`)
      }
    }
  })

  test('and the browser never receives it', () => {
    assert.ok(!/SUPER_ADMIN_RECOVERY_EMAIL/.test(form))
  })
})

describe('a wrong address is indistinguishable from the right one', () => {
  test('a mismatch returns the same shape, with an id no profile owns', () => {
    /*
     * This is what stops the endpoint becoming a way to discover the recovery
     * mailbox by guessing. The next step then fails exactly as a wrong code
     * does, and nothing anywhere says which of the two went wrong.
     */
    assert.match(recovery, /if \(!matches \|\| !account\) \{[\s\S]{0,260}userId: randomUUID\(\)/)
  })

  test('the comparison is constant time and case-insensitive', () => {
    assert.match(recovery, /function sameAddress/)
    assert.match(recovery, /timingSafeEqual\(x, y\)/)
    assert.match(recovery, /\.trim\(\)\.toLowerCase\(\)/)
  })

  test('a code is sent only when the address matched', () => {
    assert.match(route, /if \(result\.code && result\.email\)/)
  })

  test('the refusal never says the address was wrong', () => {
    assert.ok(!/wrong (email|address)|not recognised|no such/i.test(route))
  })
})

describe('the code is handled by the existing OTP machinery', () => {
  test('it is stored hashed, never in the clear', () => {
    const block = recovery.slice(recovery.indexOf('startSuperAdminRecoveryByEmail'))
    assert.match(block, /otp_code: hashToken\(code\)/)
  })

  test('it expires and its attempts are reset', () => {
    const block = recovery.slice(recovery.indexOf('startSuperAdminRecoveryByEmail'))
    assert.match(block, /otp_expires_at: expires/)
    assert.match(block, /otp_attempts: 0/)
  })

  test('verification and completion are the SHARED steps, not new ones', () => {
    /*
     * One OTP implementation and one reset-token implementation. This route
     * adds neither — it only changes how the code is requested.
     */
    assert.ok(!/reset_token_hash|issueResetToken/.test(route),
      'The route must not mint its own reset token.')
    assert.match(form, /recover\/verify/)
    assert.match(form, /recover\/complete/)
  })

  test('the existing verify enforces expiry, attempts and single use', () => {
    assert.match(recovery, /if \(new Date\(profile\.otp_expires_at\) < new Date\(\)\)/)
    assert.match(recovery, /otp_attempts/)
    // issueResetToken clears the code as it mints the token.
    const issue = recovery.slice(recovery.indexOf('async function issueResetToken'))
    assert.match(issue.slice(0, 400), /otp_code: null/)
  })

  test('it reuses the existing sender rather than a new provider', () => {
    assert.match(route, /sendOTPEmail\(/)
    assert.ok(!/resend|api\.resend|fetch\(/i.test(route), 'No second email implementation.')
  })
})

describe('it is rate limited and audited', () => {
  test('tighter than staff recovery, because the prize is larger', () => {
    assert.match(route, /rateLimit\(`recover-super:\$\{ip\}`, 5, 15 \* 60, 30 \* 60\)/)
  })

  test('every outcome is recorded', () => {
    assert.match(route, /auth\.super_admin_recovery_code_sent/)
    assert.match(route, /auth\.super_admin_recovery_denied/)
  })
})

describe('normal super admin sign-in is untouched', () => {
  const verifyPin = codeOf('app/api/auth/verify-pin/route.ts')

  test('still PIN-only, still no OTP', () => {
    assert.match(codeOf('lib/auth/pinPolicy.ts'), /NO_MAILBOX_ROLES: readonly string\[\] = \['super_admin'\]/)
    assert.match(verifyPin, /OTP_EXEMPT_ROLES: readonly string\[\] = NO_MAILBOX_ROLES/)
    assert.match(verifyPin, /if \(!SECRETS\.otpEnabled \|\| otpExempt\)/)
  })

  test('the recovery address is not a login identity', () => {
    assert.ok(!/superAdminRecoveryEmail/.test(verifyPin),
      'Sign-in must know nothing about the recovery address.')
  })

  test('the recovery PIN route still exists for staff and super admin', () => {
    assert.match(codeOf('app/api/auth/recover/start/route.ts'), /startRecovery\(/)
    assert.match(recovery, /SELF_RECOVERING_ROLES = NO_MAILBOX_ROLES/)
  })

  test('and the SETUP_SECRET break-glass is still there', () => {
    assert.doesNotThrow(() => readFileSync('app/setup/unlock/route.ts', 'utf8'))
    assert.doesNotThrow(() => readFileSync('app/api/setup/open/route.ts', 'utf8'))
  })
})

describe('no second account is ever created', () => {
  test('recovery updates the existing super admin only', () => {
    const block = recovery.slice(recovery.indexOf('startSuperAdminRecoveryByEmail'))
    assert.ok(!/\.insert\(/.test(block), 'Recovery must not create a profile.')
    assert.match(block, /\.eq\('role', 'super_admin'\)/)
    assert.match(block, /\.eq\('is_active', true\)/)
  })

  test('and the route creates nothing at all', () => {
    assert.ok(!/\.insert\(|createUser|auth\.users/.test(route))
  })
})

describe('the screen says what it does', () => {
  test('there is a way in from Forgot PIN', () => {
    assert.match(form, /Super admin recovery/)
    assert.match(form, /setStep\('recover-email'\)/)
  })

  test('it asks for the configured address in those words', () => {
    assert.match(form, /Enter the recovery email configured for the super admin/)
  })

  test('the misleading staff wording is gone', () => {
    // "If your account uses email verification…" was true for staff and
    // false for the super admin, on the screen where that mattered most.
    assert.ok(!/If your account uses email\s*\n?\s*verification/.test(form))
  })

  test('it leads into the shared code step, not a parallel one', () => {
    assert.match(form, /setStep\('recover-otp'\)/)
  })

  test('the input does not make iOS zoom', () => {
    const screen = form.slice(form.indexOf("step === 'recover-email'"))
    assert.match(screen.slice(0, 2600), /text-\[16px\]/)
  })
})

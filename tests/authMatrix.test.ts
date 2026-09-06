import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PIN_LENGTH, OTP_LENGTH, isValidPin, NO_MAILBOX_ROLES, usesEmailVerification,
} from '../lib/auth/pinPolicy.ts'
import { ROLE_DEFAULTS } from '../lib/access/portals.ts'

/**
 * THE AUTHENTICATION MATRIX.
 *
 *   SUPER ADMIN   4-digit PIN                 → direct access.  No OTP, no email.
 *   EVERYONE ELSE 4-digit PIN → OTP by email  → access.
 *
 * ── WHY THE BRANCH EXISTS ──────────────────────────────────────────────────
 *
 * The super admin has no corporate mailbox. A flow that requires one cannot
 * authenticate them, and — far worse — cannot RECOVER them: an email-based
 * recovery for an account with no email is a permanent lockout, which is
 * exactly what happened here, twice.
 *
 * The danger of fixing that is over-correcting: making everyone exempt, or
 * letting a missing email become an accidental exemption. Both are asserted
 * against below.
 */

const VERIFY_PIN = readFileSync('app/api/auth/verify-pin/route.ts', 'utf8')
const RECOVERY = readFileSync('lib/auth/recovery.ts', 'utf8')
const START = readFileSync('app/api/auth/recover/start/route.ts', 'utf8')
const LOGIN = readFileSync('app/(auth)/login/page.tsx', 'utf8')

/* ─────────────────────────────────────────────
   Who is exempt
   ───────────────────────────────────────────── */

describe('exactly one role signs in without a code', () => {
  test('the exemption list is super admin and nobody else', () => {
    assert.deepEqual([...NO_MAILBOX_ROLES], ['super_admin'],
      `these roles skip the sign-in code: ${NO_MAILBOX_ROLES.join(', ')}`)
  })

  test('every other role the system defines requires a code', () => {
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      if (role === 'super_admin') continue
      assert.equal(usesEmailVerification(role), true,
        `${role} would sign in on the PIN alone`)
    }
  })

  test('sign-in reads the shared list rather than its own literal', () => {
    assert.match(VERIFY_PIN, /OTP_EXEMPT_ROLES[^=]*=\s*NO_MAILBOX_ROLES/,
      'verify-pin declares its own exemption list, which can drift from recovery')
  })

  test('a missing email is NOT an exemption', () => {
    /*
     * This is the subtle one. The OTP branch used to read
     *
     *     if (!otpEnabled || !profile.email || otpExempt)
     *
     * so an account with no address fell through to a session on the PIN
     * alone. An incomplete staff record silently removed the second factor.
     */
    assert.ok(!/!SECRETS\.otpEnabled\s*\|\|\s*!profile\.email\s*\|\|\s*otpExempt/.test(VERIFY_PIN),
      'a missing email still bypasses the sign-in code')
    assert.match(VERIFY_PIN, /auth\.login_blocked_no_email/,
      'an account with no email must be refused, not signed in')
  })
})

/* ─────────────────────────────────────────────
   Recovery follows the same branch
   ───────────────────────────────────────────── */

describe('recovery branches the same way sign-in does', () => {
  test('recovery reads the same list sign-in does', () => {
    assert.match(RECOVERY, /SELF_RECOVERING_ROLES = NO_MAILBOX_ROLES/,
      'recovery keeps its own list, which can drift from sign-in')
  })

  test('the super admin path issues a reset token without a code', () => {
    const body = RECOVERY.slice(
      RECOVERY.indexOf('export async function startRecovery'),
      RECOVERY.indexOf('async function issueResetToken')
    )
    assert.match(body, /SELF_RECOVERING_ROLES\.includes/,
      'startRecovery does not branch on the role')
    assert.match(body, /needsCode: false/)
  })

  test('staff recovery still sends a code', () => {
    const body = RECOVERY.slice(RECOVERY.indexOf('export async function startRecovery'))
    assert.match(body, /needsCode: true/)
    assert.match(body, /otp_code:\s*hashToken\(code\)/,
      'the staff path must still email a code, stored hashed')
  })

  test('the reset token is a permission, never a session', () => {
    for (const [name, src] of [['recovery', RECOVERY], ['start', START]] as const) {
      assert.ok(!/createSession|SESSION_COOKIE|cce_session/.test(src),
        `the ${name} module creates a session — recovery would become a login`)
    }
  })

  test('recovering does not consume the recovery PIN', () => {
    // Otherwise the second forgotten PIN is a permanent lockout, which is
    // precisely the reported failure.
    const complete = RECOVERY.slice(RECOVERY.indexOf('export async function completeRecovery'))
    const update = complete.slice(complete.indexOf('.update({'), complete.indexOf('}).eq('))
    assert.ok(!/recovery_pin_hash\s*:/.test(update),
      'completeRecovery clears the recovery PIN, making recovery single-use')
  })
})

/* ─────────────────────────────────────────────
   The path with no second factor is guarded
   ───────────────────────────────────────────── */

describe('the no-second-factor path is made expensive to guess', () => {
  test('it has its own ceiling, separate from the shared one', () => {
    assert.match(START, /SELF_RECOVERY_KEY/,
      'the super admin path shares a ceiling with staff recovery, which is backed by email')
    assert.match(START, /SELF_RECOVERY_CEILING/)
  })

  test('the seal is temporary, not permanent', () => {
    /*
     * A permanent lock an attacker can trigger and the owner cannot clear is a
     * denial of service against the one account with no other way in.
     */
    const block = START.match(/const SELF_RECOVERY_BLOCK\s*=\s*([0-9*\s]+)/)
    assert.ok(block, 'no block duration declared')

    // Evaluate the arithmetic rather than pattern-matching the text: "60 * 60"
    // ends in a zero, which a naive regex reads as "zero seconds".
    const seconds = block[1].split('*').map(n => Number(n.trim())).reduce((a, b) => a * b, 1)
    assert.ok(Number.isFinite(seconds) && seconds > 0, 'the seal never lifts')
    assert.ok(seconds <= 24 * 60 * 60,
      `the seal lasts ${seconds}s — long enough to be a denial of service against the owner`)
  })

  test('the ceiling is low enough to matter', () => {
    const ceiling = Number(START.match(/const SELF_RECOVERY_CEILING\s*=\s*(\d+)/)?.[1])
    assert.ok(ceiling > 0 && ceiling <= 20,
      `${ceiling} guesses per window is too many against a ${10 ** PIN_LENGTH}-value space`)
  })

  test('every step is rate limited and audited', () => {
    assert.match(START, /rateLimit\(/)
    assert.match(START, /isBlocked\(/)
    assert.match(START, /recordAudit/)
  })
})

/* ─────────────────────────────────────────────
   PIN length, across the matrix
   ───────────────────────────────────────────── */

describe('every account type uses a four-digit PIN', () => {
  test('four is accepted, three, five, six and eight are not', () => {
    assert.equal(PIN_LENGTH, 4)
    assert.equal(isValidPin('1024'), true)
    assert.equal(isValidPin('5009'), true)
    assert.equal(isValidPin('7391'), true)
    assert.equal(isValidPin('2468'), true)
    for (const bad of ['102', '10245', '102456', '10245678']) {
      assert.equal(isValidPin(bad), false, `${bad} was accepted as a PIN`)
    }
  })

  test('the OTP is a different length and stays that way', () => {
    assert.equal(OTP_LENGTH, 6)
    assert.notEqual(OTP_LENGTH, PIN_LENGTH)
  })
})

/* ─────────────────────────────────────────────
   What the person is told
   ───────────────────────────────────────────── */

describe('the sign-in screen does not promise an email to accounts that have none', () => {
  test('the PIN step does not mention email', () => {
    const pinStep = LOGIN.slice(LOGIN.indexOf("{step === 'pin' &&"), LOGIN.indexOf("{step === 'otp' &&"))
    assert.ok(!/email/i.test(pinStep),
      'the PIN screen promises an email before it knows whether this account uses one')
  })

  test('the recovery screen branches on needsCode rather than assuming a code', () => {
    assert.match(LOGIN, /d\.needsCode === false && d\.resetToken/,
      'the login screen does not handle the no-code recovery path')
  })
})

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PIN_LENGTH } from '../lib/auth/pinPolicy.ts'

/**
 * ACCOUNT RECOVERY — the contract.
 *
 * ── THE SCENARIO THIS MUST NEVER REGRESS ───────────────────────────────────
 *
 *   super admin has PIN A
 *     → recovers, chooses PIN B     → signs in with B
 *     → later forgets B
 *     → recovers AGAIN, chooses C   → signs in with C
 *     → and again, D …
 *
 * That happened for real: the account was recovered once, a new PIN was
 * chosen, and it was forgotten again — with no way back except a developer
 * editing the database. Recovery that works once is not recovery.
 *
 * The property that makes it repeatable is that completeRecovery does NOT
 * touch recovery_pin_hash. If setting a new PIN also consumed the recovery
 * PIN, the second attempt would have nothing to present.
 *
 * ── AND THE PROPERTY THAT KEEPS IT FROM BEING A BACKDOOR ───────────────────
 *
 * The recovery PIN alone does nothing. It selects an account and triggers a
 * one-time code to that account's registered mailbox; only the code
 * authorises the reset. Four digits are not enough to take over an account,
 * because four digits are not the whole check.
 *
 * These assert the source contract. Driving the three endpoints against a live
 * database is recorded separately as NOT VERIFIED.
 */

const RECOVERY = readFileSync('lib/auth/recovery.ts', 'utf8')
const START = readFileSync('app/api/auth/recover/start/route.ts', 'utf8')
const VERIFY = readFileSync('app/api/auth/recover/verify/route.ts', 'utf8')
const COMPLETE = readFileSync('app/api/auth/recover/complete/route.ts', 'utf8')

describe('recovery can be used more than once', () => {
  test('completing a recovery does NOT clear the recovery PIN', () => {
    const body = RECOVERY.slice(RECOVERY.indexOf('export async function completeRecovery'))
    const update = body.slice(body.indexOf('.update({'), body.indexOf('}).eq('))

    assert.ok(!/recovery_pin_hash\s*:/.test(update),
      'completeRecovery writes recovery_pin_hash — recovery would become single-use, ' +
      'which is exactly how the account was locked out a second time')
  })

  test('the reset token is single use, but the recovery PIN is not', () => {
    const body = RECOVERY.slice(RECOVERY.indexOf('export async function completeRecovery'))
    assert.match(body, /reset_token_hash:\s*null/,
      'the reset token must be cleared after use')
  })
})

describe('the recovery PIN is never sufficient on its own', () => {
  test('starting recovery issues a code and no session', () => {
    const body = RECOVERY.slice(
      RECOVERY.indexOf('export async function startRecovery'),
      RECOVERY.indexOf('export type RecoveryVerify')
    )
    assert.match(body, /otp_code/, 'recovery must send a one-time code')
    assert.ok(!/createSession|pin_sessions|cce_session/.test(body),
      'startRecovery must not create a session')
  })

  test('no step of recovery creates a session', () => {
    for (const [name, src] of [['start', START], ['verify', VERIFY], ['complete', COMPLETE]] as const) {
      assert.ok(!/createSession|SESSION_COOKIE|cce_session/.test(src),
        `the ${name} step creates a session — recovery would bypass the OTP that normal sign-in requires`)
    }
  })

  test('the reset token authorises only the set-new-PIN step', () => {
    // If the proxy knew about it, it would be a session by another name.
    const proxy = readFileSync('proxy.ts', 'utf8')
    assert.ok(!/reset_token/.test(proxy),
      'the proxy accepts the reset token, which makes it a session')
  })

  test('a wrong recovery PIN and an unknown one are answered identically', () => {
    // Distinguishing them tells an attacker which guesses are worth pursuing.
    const body = RECOVERY.slice(RECOVERY.indexOf('export async function startRecovery'))
    const messages = [...body.matchAll(/reason: '([^']*not recognised[^']*)'/g)].map(m => m[1])
    assert.ok(messages.length >= 2, 'expected the same wording for both cases')
    assert.equal(new Set(messages).size, 1,
      `recovery reveals which PINs exist: ${[...new Set(messages)].join(' / ')}`)
  })
})

describe('recovery obeys the PIN policy', () => {
  test('the new PIN goes through the shared policy, not a local rule', () => {
    assert.match(RECOVERY, /pinRejectionReason\(newPin\)/,
      'completeRecovery must apply the shared PIN policy')
  })

  test('the endpoints validate against PIN_PATTERN and OTP_PATTERN', () => {
    assert.match(START, /PIN_PATTERN/)
    assert.match(VERIFY, /OTP_PATTERN/)
    assert.match(COMPLETE, /PIN_PATTERN/)
  })

  test('a recovered PIN cannot collide with another active account', () => {
    const body = RECOVERY.slice(RECOVERY.indexOf('export async function completeRecovery'))
    assert.match(body, /verifyPIN\(newPin/,
      'completeRecovery must check the new PIN against other active accounts')
    assert.match(body, /409/, 'a collision must be refused, not silently allowed')
  })
})

describe('recovery is rate limited and audited', () => {
  test('every step is rate limited', () => {
    for (const [name, src] of [['start', START], ['verify', VERIFY], ['complete', COMPLETE]] as const) {
      assert.match(src, /rateLimit\(/, `the ${name} step has no rate limit`)
    }
  })

  test('the start step also carries a global ceiling', () => {
    // Per-IP alone is defeated by rotating addresses.
    assert.match(START, /isBlocked\(/)
    assert.match(START, /recordFailure\(/)
  })

  test('outcomes are audited', () => {
    assert.match(START, /recordAudit/)
    assert.match(COMPLETE, /auth\.recovery_completed/)
  })

  test('no PIN or code is ever written to an audit record', () => {
    for (const [name, src] of [['start', START], ['verify', VERIFY], ['complete', COMPLETE]] as const) {
      const audits = [...src.matchAll(/recordAudit\(\{[\s\S]*?\}\)/g)].map(m => m[0])
      for (const audit of audits) {
        assert.ok(!/\bpin\b\s*:|newPin|recoveryPin|\bcode\b\s*:/.test(audit),
          `the ${name} step records a credential in its audit payload`)
      }
    }
  })
})

describe('the staff reset obeys the same rules', () => {
  const RESET = readFileSync('app/api/admin/reset-pin/route.ts', 'utf8')

  test('only a super admin may call it', () => {
    assert.match(RESET, /withGuard\(\{\s*roles:\s*\['super_admin'\]/)
  })

  test('the PIN is hashed on the server, never accepted pre-hashed', () => {
    assert.match(RESET, /hashPIN\(newPin\)/)
    assert.ok(!/pin_hash:\s*(body|parsed)/.test(RESET),
      'the endpoint accepts a hash from the browser')
  })

  test('it forces the colleague to choose their own PIN', () => {
    assert.match(RESET, /must_change_pin:\s*true/)
  })

  test('it refuses a PIN already in use', () => {
    assert.match(RESET, /verifyPIN\(newPin/)
    assert.match(RESET, /409/)
  })

  test('it never returns or logs the PIN', () => {
    const response = RESET.slice(RESET.lastIndexOf('return NextResponse.json'))
    assert.ok(!/newPin/.test(response), 'the reset returns the PIN it was given')
    const audits = [...RESET.matchAll(/recordAudit\(\{[\s\S]*?\}\)/g)].map(m => m[0])
    for (const audit of audits) {
      assert.ok(!/newPin/.test(audit), 'the audit record contains the PIN')
    }
  })

  test('it validates exactly the policy length', () => {
    assert.match(RESET, /PIN_PATTERN/)
    assert.match(RESET, /pinRejectionReason/)
  })
})

describe('the policy length reaches the user-facing copy', () => {
  test('the login screen speaks in PIN_LENGTH, not a hardcoded number', () => {
    const login = readFileSync('app/(auth)/login/page.tsx', 'utf8')
    assert.match(login, /\{PIN_LENGTH\}-digit/,
      'the copy hardcodes a PIN length instead of reading the policy')
    assert.equal(PIN_LENGTH, 4)
  })
})

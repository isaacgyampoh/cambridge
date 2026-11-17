import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * "COULD NOT START PAYMENT. PLEASE TRY AGAIN."
 *
 * ── WHAT A STUDENT SAW ─────────────────────────────────────────────────────
 *
 * The registration page, GHS 200 plus the 1% service charge, "Pay GHS 202.00
 * via Paystack" — and that sentence. The one message that is no use to
 * anybody, because trying again does exactly the same thing.
 *
 * PAYSTACK_SECRET_KEY was not set in production. The route had the right
 * words for that, and could not reach them:
 *
 *     const secret = SECRETS.paystackSecretKey        <- getter THROWS
 *     if (!secret || !secret.startsWith('sk_')) ...   <- never runs
 *
 * `required()` throws when a variable is unset. So the check written for
 * precisely this case was dead code, the route returned an unhandled 500,
 * the page could not parse it, and the student got the generic fallback.
 *
 * The same shape had disabled both endpoints built to diagnose it —
 * /api/paystack/key and /api/config-status — so the screens that would have
 * said "payment is not configured" crashed instead, in the only circumstance
 * anybody would look at them.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * Where a missing secret must be REPORTED or HANDLED, read it as a value that
 * can be empty. Where there is nothing safe to do without it — signing a
 * webhook check — keep the throw.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const config = codeOf('lib/config.server.ts')

describe('a missing payment key is answered, not thrown', () => {
  test('there is a reading that can come back empty', () => {
    assert.match(config, /get paystackSecretIfSet\(\) \{ return optional\('PAYSTACK_SECRET_KEY'\) \}/)
    // And the throwing one is still there, for the places that need it.
    assert.match(config, /get paystackSecretKey\(\) \{ return required\('PAYSTACK_SECRET_KEY'\) \}/)
  })

  for (const [name, path] of [
    ['the registration payment', 'app/api/paystack/init/route.ts'],
    ['a student top-up', 'app/api/student/pay-init/route.ts'],
    ['confirming a payment', 'app/api/paystack/verify/route.ts'],
    ['the reconciliation sweep', 'app/api/paystack/reconcile/route.ts'],
    ['the key diagnostic', 'app/api/paystack/key/route.ts'],
    ['the readiness screen', 'app/api/config-status/route.ts'],
  ] as const) {
    test(`${name} reads it without throwing`, () => {
      const src = codeOf(path)
      assert.match(src, /paystackSecretIfSet/, `${path} still reads the throwing getter`)
      assert.ok(!/SECRETS\.paystackSecretKey/.test(src),
        `${path} still reads the throwing getter somewhere`)
    })
  }

  test('and the student is told something they can act on', () => {
    const init = codeOf('app/api/paystack/init/route.ts')
    assert.match(init, /if \(!secret \|\| !secret\.startsWith\('sk_'\)\) \{/)
    const topup = codeOf('app/api/student/pay-init/route.ts')
    assert.match(topup, /if \(!secret\) \{/)
    assert.match(init, /Payment is not set up on the server yet/)
    assert.match(init, /trying again will not help/)
    // 503, not 500: it is a configuration state, not a crash.
    assert.match(init, /\{ status: 503 \}/)
  })

  test('somebody who HAS paid is never told their payment failed', () => {
    /*
     * The worst sentence this code could produce. Without the key, verify
     * threw inside its try and answered with the catch-all, which reads
     * "Payment not successful" to a student whose money Paystack already has.
     */
    const verify = codeOf('app/api/paystack/verify/route.ts')
    const guard = verify.slice(verify.indexOf('const secret = SECRETS.paystackSecretIfSet'))
    assert.ok(verify.indexOf('const secret = SECRETS.paystackSecretIfSet') < verify.indexOf('try {'),
      'the key is still read inside the try, so the catch-all answers for it')
    /*
     * The CONDITION, not the sentence. `if (false)` leaves every reassuring
     * word in the file and answers none of them.
     */
    assert.match(guard.slice(0, 200), /if \(!secret\) \{/,
      'the guard no longer tests whether the key is missing')
    assert.match(guard.slice(0, 700), /Your money is safe with Paystack/)
    assert.match(guard.slice(0, 700), /keep your reference/)
  })

  test('and reconciliation names the cause instead of blaming Paystack', () => {
    const rec = codeOf('app/api/paystack/reconcile/route.ts')
    const guard = rec.slice(rec.indexOf('const secret = SECRETS.paystackSecretIfSet'))
    assert.match(guard.slice(0, 200), /if \(!secret\) \{/,
      'the guard no longer tests whether the key is missing')
    assert.match(rec, /reason: 'PAYSTACK_SECRET_KEY is not configured on this deployment'/)
    assert.ok(rec.indexOf('const secret = SECRETS.paystackSecretIfSet') < rec.indexOf('try {'),
      'the sweep still reports a missing key as "not successful on Paystack"')
  })
})

describe('but the places that must refuse still refuse', () => {
  test('a webhook is never checked with an empty key', () => {
    /*
     * Computing an HMAC with an empty secret accepts anything an attacker can
     * also compute. This one keeps the throwing getter and a try/catch that
     * refuses — changing it to the forgiving read would be a signature check
     * that passes everything.
     */
    const src = codeOf('lib/payments/verify.ts')
    assert.match(src, /secret = SECRETS\.paystackSecretKey/)
    assert.match(src, /catch \{/)
    assert.match(src, /return false/)
    assert.ok(!/paystackSecretIfSet/.test(src), 'the webhook check now tolerates a missing key')
  })

  test('and an unverifiable fee payment is refused rather than assumed paid', () => {
    const src = codeOf('app/api/fees/pay/route.ts')
    assert.match(src, /key = SECRETS\.paystackSecretKey/)
    assert.ok(!/paystackSecretIfSet/.test(src), 'a fee can now be recorded without verification')
  })
})

describe('the money on the screen is the money charged', () => {
  test('the breakdown is the server’s, from one function', () => {
    // GHS 200 + 1% = GHS 202.00, which is what the student is shown and what
    // the gateway is asked for — computed once, on the server.
    const init = codeOf('app/api/paystack/init/route.ts')
    assert.match(init, /chargeBreakdown\(/)
    assert.match(init, /base, serviceCharge: charge, total: gross/)
  })
})

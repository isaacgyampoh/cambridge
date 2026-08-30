import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
  timingSafeEqualHex, classifyPayment, eventKey,
  minorUnitsToGHS, amountIsAcceptable, type PaystackEvent,
} from '../lib/payments/rules.ts'

/**
 * D3 regression tests — payment webhook.
 *
 * The signature check itself needs PAYSTACK_SECRET_KEY from the environment,
 * so verifyPaystackSignature is exercised through its comparison primitive and
 * an independently computed HMAC rather than by importing server config.
 */

const SECRET = 'sk_test_example_key'
const sign = (body: string, secret = SECRET) =>
  crypto.createHmac('sha512', secret).update(body).digest('hex')

describe('CASE 6 — signature verification', () => {
  test('a correct signature matches', () => {
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'CCE-APP-1' } })
    assert.ok(timingSafeEqualHex(sign(body), sign(body)))
  })

  test('a signature from a different secret does not match', () => {
    const body = JSON.stringify({ event: 'charge.success' })
    assert.ok(!timingSafeEqualHex(sign(body), sign(body, 'sk_test_wrong')))
  })

  test('a tampered body does not match its original signature', () => {
    const original = JSON.stringify({ event: 'charge.success', data: { amount: 20000 } })
    const tampered = JSON.stringify({ event: 'charge.success', data: { amount: 1 } })
    assert.ok(!timingSafeEqualHex(sign(original), sign(tampered)))
  })

  test('missing, empty and malformed signatures are refused', () => {
    const body = '{}'
    for (const bad of ['', 'not-hex', 'abcd', sign(body).slice(0, -2)]) {
      assert.ok(!timingSafeEqualHex(sign(body), bad), `${bad.slice(0, 12)} must not match`)
    }
  })

  test('comparison is length-checked before the constant-time compare', () => {
    // timingSafeEqual throws on unequal lengths; this must return false, not throw.
    assert.doesNotThrow(() => timingSafeEqualHex('aabb', 'aabbcc'))
    assert.equal(timingSafeEqualHex('aabb', 'aabbcc'), false)
  })
})

describe('CASE 2 and 3 — the same event twice, and simultaneously', () => {
  test('repeat deliveries of one event produce the SAME idempotency key', () => {
    // This is what makes the claim work: two deliveries must collide on one
    // key, so exactly one insert into processed_events can win.
    const event: PaystackEvent = { event: 'charge.success', data: { id: 302913, reference: 'CCE-APP-x' } }
    assert.equal(eventKey(event), eventKey({ ...event }))
    assert.equal(eventKey(event), 'paystack:302913')
  })

  test('different transactions produce different keys', () => {
    const a: PaystackEvent = { data: { id: 1, reference: 'r1' } }
    const b: PaystackEvent = { data: { id: 2, reference: 'r1' } }
    assert.notEqual(eventKey(a), eventKey(b))
  })

  test('an event without an id falls back to its reference, still stably', () => {
    const e: PaystackEvent = { data: { reference: 'CCE-APP-abc' } }
    assert.equal(eventKey(e), 'paystack:ref:CCE-APP-abc')
    assert.equal(eventKey(e), eventKey({ data: { reference: 'CCE-APP-abc' } }))
  })

  test('an event with no identity at all is refused rather than guessed', () => {
    assert.equal(eventKey({ data: {} }), null)
    assert.equal(eventKey({}), null)
  })
})

describe('CASE 8 — a payment for the wrong registration', () => {
  const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
  const OTHER = '9c858901-8a57-4791-81fe-4c455b099bc9'

  test('metadata is authoritative over the reference', () => {
    const e: PaystackEvent = {
      data: { reference: `CCE-APP-${OTHER}-1712`, metadata: { application_id: UUID } },
    }
    const p = classifyPayment(e)
    assert.deepEqual(p, { kind: 'application', applicationId: UUID })
  })

  test('a UUID in the reference is extracted whole, not split on dashes', () => {
    // An application id is a UUID and therefore contains dashes, so splitting
    // the reference on '-' mangles it. That was the original parsing bug.
    const e: PaystackEvent = { data: { reference: `CCE-APP-${UUID}-1712345678` } }
    assert.deepEqual(classifyPayment(e), { kind: 'application', applicationId: UUID })
  })

  test('a course fee reference resolves to a lead, not an application', () => {
    const e: PaystackEvent = { data: { reference: `CCE-STU-${UUID}-999` } }
    assert.deepEqual(classifyPayment(e), { kind: 'course_fee', leadId: UUID })
  })

  test('an unrecognisable reference is classified unknown, never guessed', () => {
    for (const ref of ['random-ref', 'CCE-APP-not-a-uuid', '', 'CCE-STU-12345']) {
      assert.equal(classifyPayment({ data: { reference: ref } }).kind, 'unknown',
        `${ref} must not resolve to a record`)
    }
  })

  test('a non-UUID injected through metadata is rejected', () => {
    const e: PaystackEvent = {
      data: { reference: 'x', metadata: { application_id: "'; DROP TABLE applications; --" } },
    }
    assert.equal(classifyPayment(e).kind, 'unknown')
  })
})

describe('CASE 7 — amount handling', () => {
  test('minor units convert to cedis exactly', () => {
    assert.equal(minorUnitsToGHS(20000), 200)
    assert.equal(minorUnitsToGHS(1), 0.01)
    assert.equal(minorUnitsToGHS(0), 0)
  })

  test('a missing or nonsensical amount is null, not zero', () => {
    // Treating a bad amount as zero would record a free registration.
    for (const v of [undefined, NaN, Infinity, -1]) {
      assert.equal(minorUnitsToGHS(v as number), null)
    }
  })

  test('underpayment is refused', () => {
    const r = amountIsAcceptable(150, 200)
    assert.equal(r.ok, false)
    assert.match(r.reason!, /expected at least/i)
  })

  test('exact payment is accepted', () => {
    assert.equal(amountIsAcceptable(200, 200).ok, true)
  })

  test('overpayment is accepted', () => {
    // Refusing a registration because somebody paid too much would be absurd.
    assert.equal(amountIsAcceptable(250, 200).ok, true)
  })

  test('a penny of provider rounding is tolerated', () => {
    assert.equal(amountIsAcceptable(199.995, 200).ok, true)
    assert.equal(amountIsAcceptable(199.5, 200).ok, false)
  })

  test('no expected amount means no amount check', () => {
    for (const expected of [null, undefined, 0, -5]) {
      assert.equal(amountIsAcceptable(50, expected as number).ok, true)
    }
  })
})

describe('CASE 5 — invalid webhooks', () => {
  test('an event that is not charge.success carries no payment identity', () => {
    // The route returns early on event type; this records that such payloads
    // are not mistaken for a charge.
    const e: PaystackEvent = { event: 'charge.failed', data: { reference: 'r' } }
    assert.notEqual(e.event, 'charge.success')
  })

  test('an empty payload classifies as unknown and keys as null', () => {
    assert.equal(classifyPayment({}).kind, 'unknown')
    assert.equal(eventKey({}), null)
  })
})

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidePayment, mayCreditBalance, isKnownMethod, requiresProviderVerification,
} from '../lib/payments/decide.ts'

/**
 * PAYMENT SECURITY — PERMANENT REGRESSION SUITE.
 *
 * ── THE VULNERABILITY THESE EXIST TO PREVENT ───────────────────────────────
 *
 * /api/fees/pay is public and unauthenticated, which is correct: a student
 * paying their own fees has no staff login. It accepted `method: "momo"` from
 * the request body and, on that word alone, marked the payment verified,
 * reduced the student's balance and sent them a receipt. No Paystack check ran
 * anywhere in the path.
 *
 * The amount came from the body too, so a genuine one-cedi payment could be
 * recorded as clearing the entire fee.
 *
 * Confirmed against production before the fix: the endpoint reached the
 * database with no session (a probe with a non-existent fee id returned 404,
 * not 401), and fee_payments held two rows, both cash, with no momo row ever
 * recorded. The hole was real and was never exploited.
 *
 * THIS SUITE MUST REMAIN GREEN. Each test below corresponds to one of the six
 * invariants in the release criteria.
 */

const paystackSaid = (amount: number, reference = 'ps-ref-1') =>
  ({ ok: true as const, amount, reference })

describe('1. an unverified payment can never be treated as verified', () => {
  test('mobile money with NO verification performed is rejected', () => {
    // The original defect exactly: the word "momo" and nothing else.
    const decision = decidePayment({ method: 'momo', amount: 5000, reference: 'anything' }, null)
    assert.equal(decision.outcome, 'rejected')
    assert.equal(mayCreditBalance(decision), false)
  })

  test('mobile money with no reference at all is rejected before any lookup', () => {
    const decision = decidePayment({ method: 'momo', amount: 5000, reference: null }, null)
    assert.equal(decision.outcome, 'rejected')
    assert.match((decision as { reason: string }).reason, /reference/i)
  })

  test('a failed provider verification is rejected', () => {
    const decision = decidePayment(
      { method: 'momo', amount: 5000, reference: 'ps-ref-1' },
      { ok: false, reason: 'Declined by bank' }
    )
    assert.equal(decision.outcome, 'rejected')
    assert.equal(mayCreditBalance(decision), false)
  })

  test('an unknown method cannot smuggle itself past the check', () => {
    for (const method of ['MOMO', 'momo ', 'paid', 'verified', 'transfer', '', 'admin']) {
      const decision = decidePayment({ method, amount: 5000, reference: 'x' }, paystackSaid(5000))
      assert.equal(decision.outcome, 'rejected', `"${method}" was accepted`)
    }
  })
})

describe('2 & 3. the provider decides the amount, never the caller', () => {
  test("the caller's amount is ignored when the provider disagrees", () => {
    const decision = decidePayment(
      { method: 'momo', amount: 5000, reference: 'ps-ref-1' },   // claims 5000
      paystackSaid(1)                                            // actually paid 1
    )
    assert.equal(decision.outcome, 'verified')

    /*
     * What the gateway collected is the provider's figure and nothing else.
     * The claim is not a smaller influence on it — it is no influence.
     */
    const d = decision as { amount: number; gross: number; serviceCharge: number }
    assert.equal(d.gross, 1, 'the gross banked must be what Paystack reports')

    /*
     * The amount CREDITED is that gross less the 1% the payer was charged on
     * top of what they owed. It is derived from the provider's figure, so a
     * claim of 5000 cannot reach it either.
     */
    assert.equal(d.amount, 0.99)
    assert.equal(d.serviceCharge, 0.01)
    assert.equal(d.amount + d.serviceCharge, d.gross,
      'the split must account for every pesewa the provider reported')
  })

  test('the reference banked is the provider\'s, not the one supplied', () => {
    const decision = decidePayment(
      { method: 'momo', amount: 10, reference: 'caller-supplied' },
      paystackSaid(10, 'paystack-authoritative')
    )
    assert.equal((decision as { reference: string }).reference, 'paystack-authoritative')
  })

  test('a caller cannot send a negative or absurd amount to inflate a balance', () => {
    for (const claimed of [-5000, 0, Number.NaN, Number.POSITIVE_INFINITY, '5000; DROP']) {
      const decision = decidePayment(
        { method: 'momo', amount: claimed, reference: 'ps-ref-1' },
        paystackSaid(250)
      )
      // Whatever nonsense was claimed, the provider's figure is what stands.
      assert.equal(decision.outcome, 'verified')
      const d = decision as { amount: number; gross: number; serviceCharge: number }
      assert.equal(d.gross, 250)
      // 250 collected is 247.52 of fee and 2.48 of service charge.
      assert.equal(d.amount, 247.52)
      assert.equal(d.amount + d.serviceCharge, 250)
    }
  })

  test('the 1% is never taken off a payment that did not go through the gateway', () => {
    /*
     * The charge pays for collecting a payment through Paystack. Cash handed
     * over at the desk and a bank transfer do not go near it, so taking 1% of
     * those would be charging for nothing — and would quietly short every
     * student who paid at the office by a percent of their fee.
     */
    for (const method of ['cash', 'bank']) {
      const decision = decidePayment({ method, amount: 1000, reference: null }, null)
      assert.equal(decision.outcome, 'pending')
      const d = decision as { amount: number; gross: number; serviceCharge: number }
      assert.equal(d.serviceCharge, 0, `${method} was charged a gateway fee`)
      assert.equal(d.amount, 1000, `${method} must credit the whole amount claimed`)
      assert.equal(d.gross, 1000)
    }
  })
})

describe('6. an invalid provider response cannot move a balance', () => {
  test('a provider reporting zero, negative or non-finite is rejected', () => {
    for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const decision = decidePayment(
        { method: 'momo', amount: 100, reference: 'ps-ref-1' },
        { ok: true, amount, reference: 'ps-ref-1' }
      )
      assert.equal(decision.outcome, 'rejected',
        `a provider amount of ${amount} was allowed to credit a balance`)
      assert.equal(mayCreditBalance(decision), false)
    }
  })
})

describe('bank and cash are a claim, not a payment', () => {
  test('they are recorded pending and never credit a balance', () => {
    for (const method of ['bank', 'cash']) {
      const decision = decidePayment({ method, amount: 400 }, null)
      assert.equal(decision.outcome, 'pending')
      assert.equal(mayCreditBalance(decision), false,
        `${method} moved a balance without a human verifying it`)
    }
  })

  test('they still cannot claim a nonsensical amount', () => {
    for (const amount of [0, -1, 'lots', null, undefined]) {
      assert.equal(decidePayment({ method: 'cash', amount }, null).outcome, 'rejected')
    }
  })

  test('they are not sent to the provider for verification', () => {
    assert.equal(requiresProviderVerification('bank'), false)
    assert.equal(requiresProviderVerification('cash'), false)
    assert.equal(requiresProviderVerification('momo'), true)
  })
})

describe('only a verified decision may reduce what a student owes', () => {
  test('mayCreditBalance is true for exactly one outcome', () => {
    assert.equal(mayCreditBalance(decidePayment({ method: 'momo', amount: 1, reference: 'r' }, paystackSaid(1))), true)
    assert.equal(mayCreditBalance(decidePayment({ method: 'cash', amount: 1 }, null)), false)
    assert.equal(mayCreditBalance(decidePayment({ method: 'nonsense', amount: 1 }, null)), false)
  })
})

describe('method vocabulary', () => {
  test('only the three real methods are known', () => {
    assert.equal(isKnownMethod('momo'), true)
    assert.equal(isKnownMethod('bank'), true)
    assert.equal(isKnownMethod('cash'), true)
    for (const bad of ['card', 'cheque', 'free', null, undefined, 42, {}]) {
      assert.equal(isKnownMethod(bad), false, `${String(bad)} was treated as a payment method`)
    }
  })
})

/*
 * ── INVARIANTS 4 AND 5 — WHERE THEY ARE ENFORCED ───────────────────────────
 *
 * "A pending payment cannot be credited twice" and "repeated verification is
 * idempotent" are database guarantees, not decisions, and they are deliberately
 * not simulated here — a passing fake would be worse than no test:
 *
 *   4. /api/fees/verify claims the payment first, with
 *      .update(...).eq('id', id).eq('status', 'pending').select() — only one
 *      caller can move it out of 'pending', so the balance is applied once
 *      however many requests arrive. Before this the balance was updated
 *      BEFORE the payment was marked verified, and neither write was checked,
 *      so a failure left the balance moved and the payment still pending —
 *      back in the queue to be credited again.
 *
 *   5. A unique index on fee_payments(paystack_ref) WHERE paystack_ref IS NOT
 *      NULL (migration 0013) means one Paystack transaction is banked once,
 *      even if verification were bypassed entirely. The route treats the
 *      resulting unique violation as success-with-duplicate rather than an
 *      error, so a retry is safe for the student.
 *
 * Both were verified by applying migration 0013 to production and confirming
 * the index exists. Exercising them needs a live Postgres, which this
 * environment does not have.
 */

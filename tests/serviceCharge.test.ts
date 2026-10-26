import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SERVICE_CHARGE_RATE, serviceChargeOn, grossWithCharge, chargeBreakdown,
  splitGross, disclosureLines, isPayableAmount,
} from '../lib/payments/serviceCharge.ts'
import { paymentSplit, expectedGross } from '../lib/payments/rules.ts'
import { registrationBase, REGISTRATION_FEE_FALLBACK } from '../lib/payments/registrationFee.ts'

/**
 * THE 1% SERVICE CHARGE.
 *
 * ── THE ONE THING THAT MUST NOT HAPPEN ─────────────────────────────────────
 *
 * The payer is charged 1% on top of what they owe. So the amount Paystack
 * collects is not the amount the fee ledger should be credited, and the whole
 * risk of this feature is one line crediting the wrong one of the two:
 *
 *   crediting the gross  → a GHS 1,000 balance cleared by GHS 1,010, leaving
 *                          every paying student in credit, for ever
 *   charging the base    → the charge never collected at all
 *
 * Every figure below is checked to the pesewa, and the split is checked to
 * account for every pesewa that arrived — nothing invented, nothing lost.
 */

describe('what the charge comes to', () => {
  test('it is one percent', () => {
    assert.equal(SERVICE_CHARGE_RATE, 0.01)
    assert.equal(serviceChargeOn(1000), 10)
    assert.equal(serviceChargeOn(200), 2)
  })

  test('the real course fees, to the pesewa', () => {
    // 5,950 in person and 4,950 online are the current PMP fees.
    assert.equal(serviceChargeOn(5950), 59.5)
    assert.equal(grossWithCharge(5950), 6009.5)
    assert.equal(serviceChargeOn(4950), 49.5)
    assert.equal(grossWithCharge(4950), 4999.5)
  })

  test('a fraction of a pesewa is rounded, not carried', () => {
    /*
     * 1% of GHS 333.33 is GHS 3.3333, which nobody can pay. Rounding to the
     * nearest pesewa gives 3.33 and a total of 336.66 — a figure a gateway
     * can actually collect.
     */
    assert.equal(serviceChargeOn(333.33), 3.33)
    assert.equal(grossWithCharge(333.33), 336.66)
  })

  test('and the total is never a floating-point ghost', () => {
    /*
     * 0.1 + 0.2 arithmetic in cedis produces totals like 1010.0000000000001,
     * which a gateway rejects and a receipt prints. Every figure here is
     * computed in whole pesewas for that reason.
     */
    for (const base of [0.1, 0.7, 1.15, 29.99, 1234.56, 99999.99]) {
      const b = chargeBreakdown(base)
      for (const value of [b.base, b.charge, b.gross]) {
        assert.equal(Math.round(value * 100), Number((value * 100).toFixed(0)),
          `${value} is not a whole number of pesewas`)
      }
      assert.equal(Math.round(b.base * 100) + Math.round(b.charge * 100), Math.round(b.gross * 100))
    }
  })

  test('nothing to pay carries nothing to charge', () => {
    // A charge is never the reason a payment cannot be made.
    for (const nothing of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(serviceChargeOn(nothing as number), 0)
      assert.equal(grossWithCharge(nothing as number), 0)
      assert.equal(isPayableAmount(nothing), false)
    }
  })
})

describe('splitting what arrived back into fee and charge', () => {
  test('the split accounts for every pesewa', () => {
    /*
     * The invariant. Base plus charge is exactly what was collected — never a
     * pesewa invented and never one lost, whatever the figure.
     */
    for (const gross of [1, 1.01, 202, 250, 1010, 4999.5, 6009.5, 336.66, 99999.99]) {
      const s = splitGross(gross)
      assert.equal(
        Math.round(s.base * 100) + Math.round(s.charge * 100),
        Math.round(gross * 100),
        `the split of ${gross} does not add up`,
      )
      assert.ok(s.base > 0 && s.charge >= 0)
      assert.ok(s.base < gross, 'the fee credited must be less than the total collected')
    }
  })

  test('a total this system produced comes apart into what it was made of', () => {
    for (const base of [200, 1000, 333.33, 4950]) {
      assert.equal(splitGross(grossWithCharge(base)).base, base,
        `${base} did not survive the round trip`)
    }
  })

  test('and it says it was derived', () => {
    /*
     * Inverting a rounded figure cannot always land on the pesewa the base
     * actually was, so the caller records a reconstruction as one rather than
     * presenting it as fact.
     */
    assert.equal(splitGross(1010).derived, true)
  })
})

describe('reading the split off a real payment', () => {
  const event = (metadata: Record<string, unknown>) => ({ data: { amount: 101000, metadata } })

  test('the figures this system wrote at checkout are used as they stand', () => {
    const split = paymentSplit(event({ base_amount: 1000, service_charge: 10 }), 1010)
    assert.deepEqual(split, { base: 1000, charge: 10, derived: false })
  })

  test('metadata that does not add up to the money is discarded', () => {
    /*
     * The important one. base_amount and service_charge are written by this
     * system and signed by Paystack, so they cannot be altered in flight —
     * but they can still describe a DIFFERENT transaction, or have been
     * written by hand in the Paystack dashboard.
     *
     * Checking them against the money that actually arrived is what stops a
     * stale or invented base crediting a fee it has nothing to do with.
     */
    const lying = paymentSplit(event({ base_amount: 5000, service_charge: 0 }), 1010)
    assert.equal(lying.derived, true, 'metadata that contradicts the amount was trusted')
    assert.equal(lying.base + lying.charge, 1010)
    assert.ok(lying.base < 1010)
  })

  test('a claim that the whole payment was fee is refused', () => {
    // The shape an attacker would want: no charge, everything credited.
    const greedy = paymentSplit(event({ base_amount: 1010, service_charge: 0 }), 1010)
    assert.equal(greedy.derived, true)
    assert.ok(greedy.base < 1010, 'a browser-set base was allowed to keep the charge')
  })

  test('a payment with no such metadata is split anyway', () => {
    // One taken before the charge existed, or started outside the portal.
    const old = paymentSplit({ data: { amount: 101000 } }, 1010)
    assert.equal(old.derived, true)
    assert.equal(old.base, 1000)
  })

  test('metadata that is self-consistent but describes other money is discarded', () => {
    /*
     * The other half of the check, and the one a single test can miss:
     * base 1,000 with a charge of 10 IS internally correct — 10 is 1% of
     * 1,000 — but this payment collected 500. Accepting it would credit a fee
     * with twice what arrived.
     *
     * So both questions have to be asked: is the charge right for that base,
     * AND is that base what actually turned up.
     */
    const mismatched = paymentSplit({ data: { amount: 50000, metadata: { base_amount: 1000, service_charge: 10 } } }, 500)
    assert.equal(mismatched.derived, true, 'metadata was trusted against a different amount')
    assert.equal(mismatched.base + mismatched.charge, 500)
    assert.ok(mismatched.base < 500)
  })

  test('a pesewa of provider rounding is tolerated, a cedi is not', () => {
    assert.equal(paymentSplit(event({ base_amount: 1000, service_charge: 10.01 }), 1010.01).derived, false)
    assert.equal(paymentSplit(event({ base_amount: 1000, service_charge: 11 }), 1010).derived, true)
  })
})

describe('what a registration payment is checked against', () => {
  test('the expected figure includes the charge', () => {
    /*
     * Comparing what arrived against the bare fee would read every correct
     * payment as an overpayment — and would accept a payment of exactly the
     * fee from somebody who had found a way to skip the charge.
     */
    assert.equal(expectedGross(200), 202)
    assert.equal(expectedGross(5950), 6009.5)
  })

  test('an unrecorded fee expects nothing, rather than expecting zero', () => {
    // Null means "do not check", which is how the amount check has always
    // treated a course with no registration fee. Zero would refuse everything.
    for (const none of [null, undefined, 0, -1, Number.NaN]) {
      assert.equal(expectedGross(none as number | null), null)
    }
  })
})

describe('where the registration fee comes from', () => {
  test('the course record, when it has one', () => {
    assert.deepEqual(registrationBase({ registration_fee: 350 }), { amount: 350, fromCourse: true })
    assert.deepEqual(registrationBase({ registration_fee: '350.50' }), { amount: 350.5, fromCourse: true })
  })

  test('and a named fallback when it does not, flagged as such', () => {
    /*
     * The fallback is deliberately the GHS 200 the apply page has always
     * charged, so moving the figure out of the browser did not reprice
     * anything. `fromCourse: false` is what the route logs, so a course priced
     * by default rather than by decision can be found and corrected.
     */
    assert.equal(REGISTRATION_FEE_FALLBACK, 200)
    for (const missing of [null, undefined, {}, { registration_fee: null }, { registration_fee: 0 }]) {
      const r = registrationBase(missing as { registration_fee?: number | null } | null)
      assert.equal(r.amount, 200)
      assert.equal(r.fromCourse, false)
    }
  })
})

describe('the payer is told before they pay', () => {
  test('three lines: amount, charge, total', () => {
    assert.deepEqual(disclosureLines(1000), [
      'Amount: GHS 1000.00',
      'Service charge (1%): GHS 10.00',
      'Total to pay: GHS 1010.00',
    ])
  })
})

/* ─────────────────────────────────────────────────────────────────────────── */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the ledger is credited the fee, not the fee plus the charge', () => {
  const webhook = codeOf('app/api/webhooks/paystack/route.ts')

  test('a course-fee payment credits the base', () => {
    assert.match(webhook, /const split = paymentSplit\(event, amount\)/)
    assert.match(webhook, /apply_fee_payment', \{\s*\n?\s*p_lead: leadId, p_amount: split\.base,/)
  })

  test('and records the payment at the base, with the gross kept beside it', () => {
    /*
     * The gross and the charge both survive in the stored provider response,
     * so the full transaction can be reconciled against the Paystack
     * settlement — which pays out the gross.
     */
    assert.match(webhook, /p_amount: split\.base,/)
    assert.match(webhook, /cce_service_charge: split\.charge/)
    assert.match(webhook, /cce_gross_paid: amount/)
    assert.ok(!/p_amount: amount,/.test(webhook), 'the gross is still being recorded as the payment')
  })

  test('a registration payment is checked against the gross', () => {
    assert.match(webhook, /const expected = expectedGross\(expectedBase\)/)
    assert.match(webhook, /amountIsAcceptable\(amount, expected\)/)
  })

  test('and the application records the fee, not the charge', () => {
    assert.match(webhook, /amount_paid: split\.base,/)
  })
})

describe('the amount is settled on the server', () => {
  test('the registration route does not take an amount from the browser', () => {
    /*
     * It took `amount` from the request body, and the apply page sent a
     * hardcoded 200. Anybody who could open the developer console could
     * register for one cedi.
     */
    const init = codeOf('app/api/paystack/init/route.ts')
    assert.ok(!/const \{[^}]*\bamount\b[^}]*\} = await req\.json/.test(init),
      'the amount is still coming from the request body')
    assert.match(init, /registrationBase\(course\)/)
    assert.match(init, /amount: Math\.round\(gross \* 100\)/)
  })

  test('the apply page sends an application id, not a price', () => {
    const page = codeOf('app/apply/[marketerId]/page.tsx')
    const call = page.slice(page.indexOf("fetch('/api/paystack/init'"))
    const body = call.slice(0, call.indexOf('.then('))
    assert.ok(!/amount/.test(body), 'the browser is still naming the amount')
    assert.match(body, /applicationId/)
  })

  test('and no longer prints the fee as a literal', () => {
    const page = codeOf('app/apply/[marketerId]/page.tsx')
    assert.ok(!/GHS 200/.test(page), 'the price is back in the page source')
    assert.match(page, /selectedCourse\.registrationTotal/)
  })
})

describe('the charge is disclosed before the payer commits to it', () => {
  test('the student portal shows the total it will ask for', () => {
    /*
     * A total that appears for the first time on the gateway's own page, a
     * percent above the figure somebody agreed to, is the kind of surprise
     * that becomes a chargeback and a complaint to the bank.
     */
    const portal = codeOf('app/portal/PortalView.tsx')
    /*
     * Asserted on the MARKUP, not on the file. An import of the label that
     * nothing renders satisfies a file-wide search while the screen says
     * nothing about the charge — which is the state this exists to prevent.
     */
    assert.match(portal, /<span>\{SERVICE_CHARGE_LABEL\}<\/span>/,
      'the charge label is imported but not shown')
    assert.match(portal, /\{ghs\(serviceChargeOn\(Number\(amount\)\)\)\}/)
    assert.match(portal, /\{ghs\(grossWithCharge\(Number\(amount\)\)\)\}/)
  })

  test('the apply page shows it on both payment steps', () => {
    const page = codeOf('app/apply/[marketerId]/page.tsx')
    assert.match(page, /1% service charge/)
    assert.match(page, /serviceChargeOn\(Number\(amount\)\)/)
  })

  test('and says the bank transfer does not carry it', () => {
    // Because it does not go near the gateway. Charging for it would be
    // charging for nothing.
    const page = codeOf('app/apply/[marketerId]/page.tsx')
    assert.match(page, /By bank transfer/)
  })
})

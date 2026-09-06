import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * REGISTRATION CONTRACT — the submit endpoint must agree with the database
 * and with the form that posts to it.
 *
 * ── WHAT THIS CAUGHT, END TO END, AGAINST PRODUCTION ───────────────────────
 *
 * Submitting the real public registration endpoint over HTTP returned:
 *
 *   payment_method omitted   → HTTP 500  "We could not save your application"
 *   payment_method 'paystack'→ HTTP 400  "expected one of online|cash"
 *   payment_method 'cash'    → HTTP 200
 *
 * Two independent defects:
 *
 *   1. The Zod default was 'online'. The Postgres enum payment_method contains
 *      paystack | cash | bank_transfer | mobile_money — 'online' is not a
 *      member, so the INSERT failed with 22P02 and the applicant saw a 500.
 *      This predated the hardening work.
 *
 *   2. Hardening the field to z.enum(['online','cash']) then rejected the
 *      value the real form sends. app/apply/[marketerId]/page.tsx posts
 *      payment_method: 'paystack'. So the registration link could not be used
 *      at all: every submission was refused with a 400.
 *
 * Production held zero applications created after 3 September.
 *
 * These tests pin the schema to the database enum and to what the form sends,
 * because the failure mode is silent from the server's side — the endpoint
 * behaves exactly as written, and only an end-to-end submission reveals that
 * what it accepts and what anything sends have nothing in common.
 */

const ROUTE = readFileSync('app/api/applications/submit/route.ts', 'utf8')
const FORM = readFileSync('app/apply/[marketerId]/page.tsx', 'utf8')

/**
 * The payment_method enum as it exists in Postgres, read on 6 September 2026:
 *
 *   SELECT unnest(enum_range(NULL::payment_method))::text;
 */
const DB_PAYMENT_METHODS = ['paystack', 'cash', 'bank_transfer', 'mobile_money']

describe('the submit schema matches the database enum', () => {
  test('every accepted payment method is a real enum member', () => {
    const declared = ROUTE.match(/payment_method:\s*z\.enum\(\[([^\]]+)\]\)/)
    assert.ok(declared, 'payment_method is no longer a z.enum — check this test still applies')

    const accepted = [...declared[1].matchAll(/'([^']+)'/g)].map(m => m[1])
    assert.ok(accepted.length > 0)

    for (const value of accepted) {
      assert.ok(DB_PAYMENT_METHODS.includes(value),
        `the schema accepts "${value}", which the payment_method enum does not contain — ` +
        `the INSERT will fail with 22P02 and the applicant will see a 500`)
    }
  })

  test('the default is a value the database can store', () => {
    const def = ROUTE.match(/payment_method:[\s\S]{0,200}?\.default\('([^']+)'\)/)
    assert.ok(def, 'payment_method has no default')
    assert.ok(DB_PAYMENT_METHODS.includes(def[1]),
      `the default is "${def[1]}", which is not a member of the enum`)
  })
})

describe('the submit schema accepts what the form actually sends', () => {
  test('every payment_method literal in the form is accepted by the endpoint', () => {
    const declared = ROUTE.match(/payment_method:\s*z\.enum\(\[([^\]]+)\]\)/)
    const accepted = [...declared![1].matchAll(/'([^']+)'/g)].map(m => m[1])

    // What the registration page assigns to payment_method.
    const sent = [...FORM.matchAll(/payment_method['"]?\s*[:,]\s*['"]([a-z_]+)['"]/g)]
      .map(m => m[1])
      .concat([...FORM.matchAll(/set\('payment_method',\s*'([a-z_]+)'\)/g)].map(m => m[1]))

    assert.ok(sent.length > 0, 'no payment_method literal found in the form')

    for (const value of [...new Set(sent)]) {
      assert.ok(accepted.includes(value),
        `the form sends payment_method "${value}" but the endpoint accepts only ` +
        `[${accepted.join(', ')}] — registration is refused with a 400`)
    }
  })
})

describe('fields the database requires are required by the schema', () => {
  /**
   * applications.email is NOT NULL. Treating it as optional turned a missing
   * address into a 23502 constraint violation and a 500, instead of a field
   * telling the applicant what was wrong.
   */
  test('email is required, because the column is NOT NULL', () => {
    const emailLine = ROUTE.match(/^\s*email:\s*z\.string\(\)[^\n]*/m)
    assert.ok(emailLine, 'no email field in the schema')
    assert.ok(!/\.optional\(\)|\.nullable\(\)/.test(emailLine[0]),
      'email is optional in the schema but NOT NULL in the database')
  })

  test('class mode is required and has no default', () => {
    // Defaulting the class mode is the original wrong-admission-letter bug.
    const line = ROUTE.match(/^\s*delivery:\s*z\.string\(\)[^\n]*/m)
    assert.ok(line, 'no delivery field in the schema')
    assert.ok(!/\.default\(/.test(line[0]),
      'delivery has a default — guessing the class mode is what sent an online student a physical letter')
  })
})

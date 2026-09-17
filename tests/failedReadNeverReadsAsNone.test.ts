import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * A FAILED READ MUST NEVER BE SHOWN AS "THERE IS NOTHING".
 *
 * The same fault, in the three places where it costs the most: a student's
 * balance, a student's classes, and the queue of payments an accountant has
 * to verify. In each case the data was read without checking whether the read
 * worked, and an empty array rendered as a confident statement of fact.
 */

const student = readFileSync('app/(portal)/student/page.tsx', 'utf8')
const fees = readFileSync('app/(portal)/finance/student-fees/page.tsx', 'utf8')

describe('a student is never told they owe nothing on no evidence', () => {
  test('the balance knows when it could not be read', () => {
    /*
     * invoices starts empty and stays empty when the read fails, so the
     * banner said "Nothing due" — the most consequential sentence on the
     * page — to somebody whose invoices simply had not loaded.
     */
    assert.match(student, /const balanceUnknown = invoicesState === 'error' \|\| invoicesState === 'loading'/)
  })

  test('and says so instead of a figure', () => {
    assert.match(student, /balanceUnknown[\s\S]{0,160}'Not available'/)
    assert.match(student, /could not check your balance just now/)
  })

  test('"Nothing due" is only ever said when the invoices really were read', () => {
    // "Nothing due" must sit on the far side of the balanceUnknown branch.
    const nothingDue = student.indexOf("'Nothing due'")
    const branch = student.lastIndexOf('balanceUnknown', nothingDue)
    assert.ok(branch > -1 && nothingDue - branch < 260,
      '"Nothing due" is reachable without first establishing the balance was read')
  })
})

describe('a student is never told they have no classes on no evidence', () => {
  test('a failed read is distinguished from an empty enrolment', () => {
    assert.match(student, /classesState === 'error' \?/)
    assert.match(student, /could not load your classes just now/)
  })

  test('and loading is distinguished from both', () => {
    assert.match(student, /classesState === 'loading' \?/)
  })
})

describe('an accountant is never told there is nothing to verify on no evidence', () => {
  test('the loader no longer turns a failure into an empty list', () => {
    // `.catch(() => ({ payments: [] }))` made an unreachable server look
    // exactly like nobody having paid.
    assert.ok(!/catch\(\(\) => \(\{ payments: \[\] \}\)\)/.test(fees))
    assert.match(fees, /setPendingError\(/)
  })

  test('a refused response is a failure, not an empty queue', () => {
    assert.match(fees, /if \(!res\.ok\) throw new Error/)
  })

  test('the screen shows the reason and offers to try again', () => {
    assert.match(fees, /pendingError \?/)
    assert.match(fees, /Try again/)
  })

  test('"Nothing to verify" survives only for a genuinely empty queue', () => {
    const idx = fees.indexOf('Nothing to verify')
    const before = fees.slice(Math.max(0, idx - 400), idx)
    assert.match(before, /pendingError \?[\s\S]*pending\.length === 0 \?/)
  })
})

describe('the student portal shows nothing meaningless', () => {
  test('the empty decorative square is gone', () => {
    // A 36px coloured box containing only whitespace, next to every class.
    assert.ok(!/accent-soft\)\] flex items-center justify-center flex-shrink-0">\s*\n\s*\n\s*<\/div>/.test(student))
    assert.match(student, /<BookOpen size=\{16\}/)
  })
})

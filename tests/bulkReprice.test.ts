import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { planBulkReprice, planMatches, type FeeRow } from '../lib/finance/bulkReprice.ts'
import { parseClassMode, type ClassMode } from '../lib/classMode.ts'

const ROUTE = 'app/api/fees/reprice-bulk/route.ts'
const code = (p: string) => readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** PMP as Isaac confirmed it: 5,950 in person, 4,950 online. */
const fee = (m: ClassMode) => (m === 'online' ? 4950 : 5950)

const row = (o: Partial<FeeRow> & { id: string }): FeeRow => ({
  student_name: 'A Student', delivery: 'in_person', total_fee: 3950, amount_paid: 0, ...o,
})

describe('planning, before anything is written', () => {
  test('a student on an old fee is listed with the before and after', () => {
    const p = planBulkReprice([row({ id: '1', total_fee: 3950 })], fee, parseClassMode)
    assert.equal(p.changes.length, 1)
    assert.equal(p.changes[0].from, 3950)
    assert.equal(p.changes[0].to, 5950)
    assert.equal(p.skipped.length, 0)
  })

  test('online and in-person students each get their own price', () => {
    const p = planBulkReprice([
      row({ id: '1', delivery: 'in_person' }),
      row({ id: '2', delivery: 'online' }),
    ], fee, parseClassMode)
    assert.deepEqual(p.changes.map(c => c.to).sort(), [4950, 5950])
  })

  test('somebody already on the current fee is left alone', () => {
    const p = planBulkReprice([row({ id: '1', total_fee: 5950 })], fee, parseClassMode)
    assert.equal(p.changes.length, 0)
    assert.equal(p.skipped[0].why, 'Already on the current fee')
  })

  test('a record with no class mode is skipped and SAID, not guessed', () => {
    // Guessing charges one of them the other's fee.
    const p = planBulkReprice([row({ id: '1', delivery: null })], fee, parseClassMode)
    assert.equal(p.changes.length, 0)
    assert.equal(p.skipped.length, 1)
    assert.match(p.skipped[0].why, /class mode/i)
  })

  test('what was already paid is carried through, never altered', () => {
    const p = planBulkReprice([row({ id: '1', total_fee: 3950, amount_paid: 1000 })], fee, parseClassMode)
    assert.equal(p.changes[0].amountPaid, 1000)
    assert.equal(p.changes[0].balance, 4950)
  })

  test('a correction that leaves a student in credit is counted and flagged', () => {
    const p = planBulkReprice([row({ id: '1', delivery: 'online', total_fee: 8000, amount_paid: 6000 })], fee, parseClassMode)
    assert.equal(p.changes[0].to, 4950)
    assert.equal(p.changes[0].balance, -1050)
    assert.equal(p.changes[0].inCredit, true)
    assert.equal(p.creditCount, 1)
  })

  test('the effect on the total owed is reported', () => {
    const p = planBulkReprice([
      row({ id: '1', total_fee: 3950, amount_paid: 0 }),
      row({ id: '2', total_fee: 3950, amount_paid: 1000 }),
    ], fee, parseClassMode)
    assert.equal(p.owedBefore, 3950 + 2950)
    assert.equal(p.owedAfter, 5950 + 4950)
  })

  test('only the rows that change count toward that comparison', () => {
    // Otherwise the figure shown is not the effect of pressing the button.
    const p = planBulkReprice([
      row({ id: '1', total_fee: 3950 }),
      row({ id: '2', total_fee: 5950 }),
    ], fee, parseClassMode)
    assert.equal(p.changes.length, 1)
    assert.equal(p.owedBefore, 3950)
    assert.equal(p.owedAfter, 5950)
  })

  test('an empty programme plans nothing', () => {
    const p = planBulkReprice([], fee, parseClassMode)
    assert.deepEqual(p, { changes: [], skipped: [], owedBefore: 0, owedAfter: 0, creditCount: 0 })
  })
})

describe('a plan may only be applied as it was shown', () => {
  const plan = planBulkReprice([row({ id: 'a' }), row({ id: 'b' })], fee, parseClassMode)

  test('the exact set matches', () => {
    assert.equal(planMatches(plan, ['a', 'b']), true)
    assert.equal(planMatches(plan, ['b', 'a']), true, 'order is not significance')
  })

  test('a student who appeared since the preview invalidates it', () => {
    assert.equal(planMatches(plan, ['a', 'b', 'c']), false)
  })

  test('a student who dropped out of it does too', () => {
    assert.equal(planMatches(plan, ['a']), false)
  })

  test('a different student entirely is refused', () => {
    assert.equal(planMatches(plan, ['a', 'z']), false)
  })

  test('a repeated id is the same student, not an extra one', () => {
    /*
     * The comparison is of SETS. A confirmation listing a student twice names
     * the same two people, so it matches; one listing a student who is not in
     * the plan does not, however it is padded.
     *
     * My first test here asserted that ['a','a'] is refused, which passed
     * whether or not the de-duplication existed — the sorted comparison
     * catches that case on its own. It was pinning nothing.
     */
    assert.equal(planMatches(plan, ['a', 'b', 'b']), true, 'the same set, written twice')
    assert.equal(planMatches(plan, ['a', 'a']), false, 'that is only one of the two')
    assert.equal(planMatches(plan, ['a', 'b', 'c', 'c']), false, 'c is not in the plan')
  })
})

describe('the route', () => {
  const s = code(ROUTE)

  test('it previews when nothing is confirmed, and writes nothing', () => {
    assert.match(s, /if \(!confirmIds\)/)
    /*
     * Anchored on code, not on a comment. A first version sliced to the
     * "Step two" banner — which this file strips before asserting, so the
     * slice ran to the end of the file and swept in the update it was
     * supposed to prove absent.
     */
    const at = s.indexOf('if (!confirmIds)')
    const end = s.indexOf('reason.length < 3', at)
    assert.notEqual(end, -1, 'the apply step must follow the preview')
    assert.doesNotMatch(s.slice(at, end), /\.update\(/, 'the preview must not write')
  })

  test('a stale plan is refused', () => {
    assert.match(s, /planMatches\(plan, confirmIds\)/)
    assert.match(s, /status: 409/)
  })

  test('a reason is required to apply', () => {
    assert.match(s, /reason\.length < 3/)
  })

  test('money already received is never written', () => {
    const at = s.indexOf("from('student_fees').update(")
    assert.notEqual(at, -1)
    const end = s.indexOf(".eq('id', change.id)", at)
    assert.notEqual(end, -1)
    assert.doesNotMatch(s.slice(at, end), /amount_paid/)
  })

  test('every student changed is recorded individually, plus a summary', () => {
    assert.match(s, /action: 'student_fee\.reprice'/)
    assert.match(s, /action: 'student_fee\.reprice_bulk'/)
  })

  test('the fee comes from the one shared rule', () => {
    assert.match(s, /feeFor\(course, mode\)/)
  })

  test('only finance may do it', () => {
    const m = /const ALLOWED = \[([^\]]*)\]/.exec(s)
    assert.ok(m)
    const roles = m[1].split(',').map(r => r.trim().replace(/['"]/g, '')).filter(Boolean).sort()
    assert.deepEqual(roles, ['accountant', 'administrator', 'super_admin'])
  })

  test('the number of rows it will touch is bounded', () => {
    assert.match(s, /MAX_ROWS/)
  })
})

describe('the screen shows the plan before it acts', () => {
  const page = readFileSync('app/(portal)/finance/student-fees/page.tsx', 'utf8')

  test('previewing and applying are two separate actions', () => {
    assert.match(page, /Show me what would change/)
    assert.match(page, /async function bulkPreview/)
    assert.match(page, /async function bulkApply/)
  })

  test('the preview sends no confirmation, so the server cannot write', () => {
    const preview = page.slice(page.indexOf('async function bulkPreview'), page.indexOf('async function bulkApply'))
    assert.doesNotMatch(preview, /confirmIds/)
  })

  test('applying confirms the exact students that were listed', () => {
    const apply = page.slice(page.indexOf('async function bulkApply'))
    assert.match(apply, /confirmIds: bulkPlan\.changes\.map/)
  })

  test('the operator sees each student and the before and after', () => {
    assert.match(page, /c\.student/)
    assert.match(page, /Number\(c\.from\)/)
    assert.match(page, /Number\(c\.to\)/)
  })

  test('students left in credit are called out, not buried', () => {
    assert.match(page, /would end up in credit/)
  })

  test('what it does to the total owed is shown before confirming', () => {
    assert.match(page, /owedBefore/)
    assert.match(page, /owedAfter/)
  })

  test('a double click cannot apply twice', () => {
    const apply = page.slice(page.indexOf('async function bulkApply'))
    assert.match(apply, /if \(bulkBusy\) return/)
  })
})

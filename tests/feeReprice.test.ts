import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { repriceTo, validateReprice, round2 } from '../lib/finance/reprice.ts'

const ROUTE = 'app/api/fees/reprice/route.ts'
const code = (p: string) => readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * Isaac reported the system still shows old fees. student_fees.total_fee is a
 * snapshot written at registration, and NOTHING in the application could
 * change it — so a student registered under an old price list showed that
 * price for ever, with no way to correct it short of editing the database.
 */

describe('what the row becomes', () => {
  test('the balance is derived, never adjusted by a difference', () => {
    const r = repriceTo(5950, 2000)
    assert.equal(r.totalFee, 5950)
    assert.equal(r.amountPaid, 2000)
    assert.equal(r.balance, 3950)
    assert.equal(r.status, 'owing')
  })

  test('a fee corrected downward can settle the record', () => {
    const r = repriceTo(2000, 2000)
    assert.equal(r.balance, 0)
    assert.equal(r.status, 'paid')
  })

  test('a fee below what was paid leaves a credit, not a refusal', () => {
    // A late discount or a correction after an overpayment. Representing it
    // is better than pretending the balance is zero.
    const r = repriceTo(1500, 2000)
    assert.equal(r.balance, -500)
    assert.equal(r.status, 'paid')
  })

  test('money is compared to the pesewa, not to floating-point zero', () => {
    const r = repriceTo(0.1 + 0.2, 0.3)
    assert.equal(r.balance, 0)
    assert.equal(r.status, 'paid')
  })

  test('amounts are rounded to the pesewa', () => {
    assert.equal(round2(5950.005), 5950.01)
    assert.equal(repriceTo(100.125, 0).totalFee, 100.13)
  })

  test('the balance is exactly total minus paid, at every magnitude', () => {
    /*
     * Derivation is enforced by the signature — repriceTo is handed only the
     * total and what was paid, so there is no delta it could adjust by. What
     * this pins is that the arithmetic is exact rather than approximately
     * right: a first version of this test used only small amounts, where a
     * one-in-ten-million error rounds away invisibly.
     */
    for (const [total, paid] of [
      [1200.55, 333.33], [999.99, 0], [0, 0], [999999.99, 0.01], [12345.67, 12345.66],
    ] as const) {
      assert.equal(repriceTo(total, paid).balance, round2(total - paid),
        `${total} - ${paid} was not derived exactly`)
    }
  })

  test('repeated corrections never drift', () => {
    let state = repriceTo(1000, 333.33)
    for (const fee of [1200.55, 999.99, 1500.01, 1200.55]) state = repriceTo(fee, state.amountPaid)
    assert.equal(state.totalFee, 1200.55)
    assert.equal(state.amountPaid, 333.33)
    assert.equal(state.balance, round2(1200.55 - 333.33))
  })
})

describe('what may be asked for', () => {
  const ok = { totalFee: 5950, reason: 'charged the old price list' }

  test('a correction with a reason is accepted', () => {
    const r = validateReprice(ok)
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.totalFee, 5950)
  })

  test('a reason is required', () => {
    // A change to what somebody owes with no explanation is
    // indistinguishable from a mistake six months later.
    for (const reason of [undefined, '', '  ', 'x']) {
      assert.equal(validateReprice({ ...ok, reason }).ok, false, `accepted reason ${JSON.stringify(reason)}`)
    }
  })

  test('nonsense amounts are refused', () => {
    for (const totalFee of [undefined, '', 'abc', -1, NaN, Infinity, 5_000_000]) {
      assert.equal(validateReprice({ ...ok, totalFee }).ok, false, `accepted ${String(totalFee)}`)
    }
  })

  test('zero is a real fee — a scholarship is not nonsense', () => {
    assert.equal(validateReprice({ ...ok, totalFee: 0 }).ok, true)
  })

  test('a number typed as text is accepted', () => {
    const r = validateReprice({ ...ok, totalFee: ' 4950 ' })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.totalFee, 4950)
  })

  test('setting the fee to what it already is is refused', () => {
    // It would write an audit row recording that nothing changed.
    assert.equal(validateReprice({ ...ok, totalFee: 5950, currentTotal: 5950 }).ok, false)
    assert.equal(validateReprice({ ...ok, totalFee: 5950, currentTotal: 4950 }).ok, true)
  })
})

describe('the route', () => {
  const s = code(ROUTE)

  test('money already received is never touched', () => {
    /*
     * amount_paid belongs to the payments that recorded it. A re-price that
     * moved it would make the ledger disagree with the receipts.
     */
    /*
     * Search FORWARD from the update. Taking the first `.eq('id',
     * studentFeeId)` in the file found the lookup near the top, which sits
     * BEFORE the update — so the slice ran backwards and came back empty.
     */
    const at = s.indexOf("from('student_fees').update(")
    assert.notEqual(at, -1, 'no update found')
    const end = s.indexOf(".eq('id', studentFeeId)", at)
    assert.notEqual(end, -1, 'the update is not scoped to one row')
    const update = s.slice(at, end)
    assert.ok(update.length > 0)
    assert.doesNotMatch(update, /amount_paid/, 'the update must not write amount_paid')
    assert.match(update, /total_fee/)
    assert.match(update, /balance/)
  })

  test('only finance may change a fee', () => {
    const m = /const ALLOWED = \[([^\]]*)\]/.exec(s)
    assert.ok(m)
    const roles = m[1].split(',').map(r => r.trim().replace(/['"]/g, '')).filter(Boolean).sort()
    assert.deepEqual(roles, ['accountant', 'administrator', 'super_admin'])
  })

  test('"use the current course fee" applies the same rule registration uses', () => {
    // Two rules for one price is how a corrected fee and a newly registered
    // one come to disagree.
    assert.match(s, /feeFor\(course, mode\)/)
  })

  test('an unknown delivery is refused rather than guessed', () => {
    /*
     * Guessing charges the in-person price to an online student.
     *
     * Checking only that `if (!mode)` exists is not enough: defaulting the
     * value makes that branch unreachable while leaving it in the file, and
     * an earlier version of this test passed with exactly that change. The
     * assignment itself must carry no fallback.
     */
    assert.match(s, /const mode = parseClassMode\(fee\.delivery\)\s*$/m,
      'parseClassMode must not be given a default')
    assert.doesNotMatch(s, /parseClassMode\(fee\.delivery\)\s*\|\|/)
    assert.match(s, /if \(!mode\)/)
  })

  test('every correction is recorded, with the before and after', () => {
    assert.match(s, /action: 'student_fee\.reprice'/)
    assert.match(s, /from: previousTotal/)
    assert.match(s, /to: next\.totalFee/)
    assert.match(s, /why: checked\.reason/)
  })
})

describe('the accountant’s screen', () => {
  const page = readFileSync('app/(portal)/finance/student-fees/page.tsx', 'utf8')

  test('a fee can be corrected from the student list', () => {
    assert.match(page, /Correct fee/)
    assert.match(page, /\/api\/fees\/reprice/)
  })

  test('it is offered even once the record is settled', () => {
    // A fee charged wrongly is worth correcting after it is paid, not only
    // before. The Record payment button is the one that hides when paid.
    const col = page.slice(page.indexOf("key: 'action'"), page.indexOf("key: 'action'") + 900)
    assert.match(col, /f\.status !== 'paid' &&/, 'recording a payment is the conditional one')
    const correct = col.slice(col.indexOf('Correct fee') - 400)
    assert.doesNotMatch(correct, /status !== 'paid'/)
  })

  test('it says that what was paid is not being changed', () => {
    assert.match(page, /already paid is not changed/)
  })

  test('a credit is announced rather than shown as a quiet minus', () => {
    assert.match(page, /inCredit/)
    assert.match(page, /in credit by/)
  })

  test('a second click cannot reprice twice', () => {
    assert.match(page, /if \(acting === repriceFor\.id\) return/)
  })
})

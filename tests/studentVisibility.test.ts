import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { READ_TABLES, ALL_TABLES_WILDCARD } from '../lib/data/policy.ts'

/**
 * A registered student must be visible to the people who act on them.
 *
 * Isaac asked whether the accountant and the project manager can see students
 * who were registered. The answer has to hold for a MANUALLY registered
 * student too, and the only way that is true is that manual registration
 * writes the same record an online one does — student_fees. These pin the
 * chain: the table each role may read, and the screens that read it.
 */

const ACADEMICS = 'app/(portal)/admin/academics/page.tsx'

function canRead(role: string, table: string): boolean {
  const tables = READ_TABLES[role] || []
  return tables.includes(ALL_TABLES_WILDCARD) || tables.includes(table)
}

describe('who can see a registered student', () => {
  test('the accountant can', () => {
    assert.equal(canRead('accountant', 'student_fees'), true)
  })

  test('the project manager can', () => {
    assert.equal(canRead('project_manager', 'student_fees'), true)
  })

  test('a super admin and an administrator can', () => {
    assert.equal(canRead('super_admin', 'student_fees'), true)
    assert.equal(canRead('administrator', 'student_fees'), true)
  })

  test('a marketer and a trainer still cannot', () => {
    // Fee balances are not theirs to read, and this widening must not leak.
    assert.equal(canRead('marketing_officer', 'student_fees'), false)
    assert.equal(canRead('trainer', 'student_fees'), false)
    assert.equal(canRead('student', 'student_fees'), false)
  })
})

describe('the screens that show them', () => {
  const academics = readFileSync(ACADEMICS, 'utf8')
  const finance = readFileSync('app/(portal)/finance/student-fees/page.tsx', 'utf8')

  test('Accounts reads the fee ledger', () => {
    assert.match(finance, /table: 'student_fees'/)
  })

  test('Academics reads the same table, not a second one', () => {
    // Two lists built from different tables is how two departments come to
    // disagree about who is registered.
    assert.match(academics, /table: 'student_fees'/)
  })

  test('the project manager reaches the Academics page', () => {
    // No separate PM screen is needed: project_manager holds the `academics`
    // portal, which grants this page.
    const portals = readFileSync('lib/access/portals.ts', 'utf8')
    const pm = /^\s{2}project_manager:\s*\[([^\]]*)\]/m.exec(portals)
    assert.ok(pm, 'project_manager has no portal list')
    assert.match(pm[1], /'academics'/)
    assert.match(portals, /academics:\s*\[[^\]]*'\/admin\/academics'/)
  })

  test('registering refreshes the student list, not the course list', () => {
    /*
     * The first version refetched courses and batches — neither of which
     * changes when a student is registered. The academic saved somebody and
     * the screen showed exactly what it showed before.
     */
    assert.match(academics, /onRegistered=\{\(\) => \{ refetchStudents\(\)/)
  })

  test('an empty list says what to do rather than nothing', () => {
    assert.match(academics, /No students registered yet/)
    assert.match(academics, /Register Student Manually/)
  })

  test('what a student owes is shown, from the same figures Accounts uses', () => {
    for (const field of ['balance', 'amount_paid', 'total_fee']) {
      assert.ok(academics.includes(field), `${field} is not shown on Academics`)
    }
  })
})

describe('a manually registered student is the same kind of record', () => {
  test('manual registration writes student_fees, which is what both screens read', () => {
    const route = readFileSync('app/api/academics/manual-registration/route.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.match(route, /from\('student_fees'\)/)
    assert.match(route, /visibleToAccounts/,
      'the route must report whether the accountant will actually see them')
  })
})

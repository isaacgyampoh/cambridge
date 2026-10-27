import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { canRead, canWrite, ownerColumnFor, embeddedRelations, FK_TARGETS } from '../lib/data/policy.ts'

/**
 * A GRANTED PORTAL HAS TO GRANT THE DATA BEHIND IT.
 *
 * ── WHAT WAS REPORTED ──────────────────────────────────────────────────────
 *
 * An admissions officer opened Finance → Payments and saw "You do not have
 * access to this information." with every figure at zero. The same message on
 * the leads screen, with no leads. And the Register student dialog offered an
 * empty programme dropdown, so the conversion could not be recorded at all.
 *
 * Three faults, one theme: a person is shown a screen and refused its data.
 *
 *   1. read access was decided by ROLE alone, while the navigation and the
 *      API path guard both honour a GRANTED portal — so granting somebody the
 *      finance portal gave them the screens and nothing on them
 *   2. `assigned_by` was missing from the foreign-key map, so the All-leads
 *      select was refused outright for every role without the wildcard
 *   3. `program_points` — the programme list — was readable by neither of the
 *      roles that register students
 */

/** The portals actually granted to the account that reported this. */
const GRANTED = [
  'dashboard', 'admissions', 'leads', 'my_earnings', 'my_links', 'clock_in',
  'messages', 'finance', 'registrations', 'grp_socials', 'grp_automation',
  'broadcast', 'my_link', 'my_flyers', 'reports', 'my_payments', 'attendance',
  'documents', 'my_leads',
]

describe('a portal grants what its own screens read', () => {
  test('the finance screens answer, instead of refusing', () => {
    for (const table of ['payments', 'invoices', 'student_fees', 'fee_payments']) {
      assert.equal(canRead(table, 'admissions_officer', GRANTED), true,
        `Finance was granted but ${table} is still refused`)
    }
  })

  test('and so do the others this person was granted', () => {
    assert.equal(canRead('documents', 'admissions_officer', GRANTED), true)
    assert.equal(canRead('applications', 'admissions_officer', GRANTED), true)
  })

  test('a portal NOT granted still grants nothing', () => {
    /*
     * The grant has to be worth something and no more. `settings` is not in
     * this person's list, so the settings table stays refused however many
     * other portals they hold.
     */
    assert.equal(canRead('settings', 'admissions_officer', GRANTED), false)
    assert.equal(canRead('cron_runs', 'admissions_officer', GRANTED), false)
  })

  test('a role with no grants gains nothing at all', () => {
    // The fault was read access ignoring portals. Fixing it must not hand
    // money tables to somebody who was never given the portal.
    for (const table of ['payments', 'invoices', 'student_fees']) {
      assert.equal(canRead(table, 'trainer', null), false, `a trainer can read ${table}`)
      assert.equal(canRead(table, 'marketing_officer', null), false, `a marketer can read ${table}`)
    }
  })

  test('granting a portal does NOT widen what somebody may change', () => {
    /*
     * Granting a portal says "you may look at this". It does not say "you may
     * move money" — and these tables are where money lives. Writing still
     * follows the role, so somebody who should genuinely do finance work is
     * given the finance ROLE.
     */
    for (const table of ['payments', 'invoices', 'student_fees', 'fee_payments']) {
      assert.equal(canWrite(table, 'admissions_officer', GRANTED), false,
        `a granted portal let ${table} be written`)
    }
  })

  test('a portal on a student row gains them nothing', () => {
    /*
     * resolvePortals honours a custom portal list for ANY role, a student's
     * included. Such a row should never exist, which is not an argument for
     * the policy depending on it not existing.
     *
     * Asserted as "the grant changes nothing", not as a flat refusal: a
     * student's own role already reads `payments` and `invoices`, because
     * that is how they see their own fees in the student portal. What must
     * not happen is a grant adding to it.
     */
    const granted = ['finance', 'leads', 'staff', 'documents']
    for (const table of ['payments', 'invoices', 'leads', 'profiles', 'student_fees', 'documents']) {
      assert.equal(
        canRead(table, 'student', granted),
        canRead(table, 'student', null),
        `holding a portal changed what a student can read of ${table}`,
      )
    }
    assert.equal(canRead('student_fees', 'student', granted), false)
    assert.equal(canRead('documents', 'student', granted), false)
  })

  test('and what a student does read stays their own rows', () => {
    // The row scope is the thing that makes reading `payments` safe for them.
    assert.equal(ownerColumnFor('payments', 'student', ['finance']), 'student_id')
    assert.equal(ownerColumnFor('invoices', 'student', ['finance']), 'student_id')
  })
})

describe('the programme list, for anybody who registers a student', () => {
  test('both roles that can register one can read it', () => {
    /*
     * Without this the Register student dialog shows "Select programme" and
     * nothing to select. The button is there, the dialog opens, and the
     * conversion cannot be recorded — which is what an admissions officer
     * reported.
     */
    for (const role of ['marketing_officer', 'admissions_officer', 'project_manager']) {
      assert.equal(canRead('program_points', role, null), true,
        `${role} cannot read the programme list`)
    }
  })

  test('it is reference data, not somebody\'s record', () => {
    // Readable by anyone who can work a lead, because it says nothing about
    // any person — it is a list of programmes and their points.
    assert.equal(canRead('program_points', 'trainer', null), true)
    assert.equal(canRead('program_points', 'student', null), false)
  })
})

describe('every embedded relation resolves to a real table', () => {
  /**
   * ── THE ONE THAT BROKE THE LEADS SCREEN ──────────────────────────────────
   *
   * /api/data checks each embedded relation in a select against the caller's
   * read access, resolving it through FK_TARGETS. An UNMAPPED relation falls
   * back to its own column name — so `assigner:assigned_by(full_name)` asked
   * whether the caller could read a table called "assigned_by", which exists
   * in no list, and the whole request was refused.
   *
   * Only the two roles holding the wildcard could open the leads screen.
   * Everybody else got an empty list and an access error, which is exactly
   * what was reported.
   *
   * This sweeps the application for every embedded relation it actually uses,
   * so the next unmapped one fails here instead of on somebody's screen.
   */
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) sourceFiles(full, out)
      else if (/\.tsx?$/.test(entry)) out.push(full)
    }
    return out
  }

  const used = new Map<string, string>()
  for (const file of [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('hooks')]) {
    const src = readFileSync(file, 'utf8')
    for (const match of src.matchAll(/select:\s*'([^']+)'/g)) {
      for (const rel of embeddedRelations(match[1])) {
        if (!used.has(rel)) used.set(rel, file)
      }
    }
  }

  test('the sweep finds the selects it is meant to', () => {
    // A sweep that matches nothing would pass for ever while proving nothing.
    assert.ok(used.size >= 5, `only ${used.size} embedded relations were found`)
    assert.ok(used.has('assigned_to'))
  })

  test('each relation named after a COLUMN is mapped', () => {
    /*
     * A relation named after a table — `courses(name)` — needs no mapping:
     * falling back to its own name asks about the right table, which is what
     * the fallback is for.
     *
     * One named after a foreign-key column does need mapping, and that is the
     * whole bug class: `assigned_by` asked about a table called "assigned_by"
     * and the request was refused. Anything ending in _id or _by is a column.
     */
    const unmapped = [...used.entries()]
      .filter(([rel]) => /_(id|by)$/.test(rel) && !FK_TARGETS[rel])
    assert.deepEqual(unmapped.map(([rel, file]) => `${rel} (${file})`), [],
      'these relations fall back to their own name and refuse the whole request')
  })

  test('the two that were missing are mapped now', () => {
    // Confirmed against the database's own foreign keys.
    assert.equal(FK_TARGETS.assigned_by, 'profiles')
    assert.equal(FK_TARGETS.staff_id, 'profiles')
  })

  test('and the leads screen\'s own select now passes for a plain role', () => {
    /*
     * The select the All-leads page actually sends, checked exactly as
     * /api/data checks it: every embedded relation resolved and read-checked.
     */
    const select = '*, assignee:assigned_to(full_name), assigner:assigned_by(full_name)'
    for (const rel of embeddedRelations(select)) {
      const target = FK_TARGETS[rel] || rel
      assert.equal(canRead(target, 'admissions_officer', GRANTED), true,
        `the leads select is still refused over ${rel}`)
    }
  })
})

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveSource, LEAD_SOURCES } from '../lib/leads/importValidation.ts'

/**
 * THE THREE THINGS THAT WERE STOPPING WORK.
 *
 *  1. Lead distribution could not be saved at all.
 *  2. Manual lead upload did not go through.
 *  3. An accountant could not mark a lead registered — it kept asking for a
 *     course and never changed the status.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const store = codeOf('lib/leads/distributionStore.ts')
const importer = codeOf('lib/leads/import.ts')
const status = codeOf('app/api/leads/status/route.ts')
const schema = readFileSync('supabase/FULL-SCHEMA.sql', 'utf8')

/* ══ 1. THE SAVE ══════════════════════════════════════════════════════════ */

describe('the allocation can be saved on the database as it is', () => {
  test('it writes to a table this application already uses', () => {
    /*
     * The save targeted lead_distribution_members, created by migration 0021,
     * which had not been run — so every attempt failed with "We could not save
     * the lead distribution settings" and the feature could not be configured
     * at all.
     */
    assert.match(store, /from\('settings'\)/)
    assert.ok(!/lead_distribution_members/.test(store))
  })

  test('nothing in the path calls a function that may not exist', () => {
    assert.ok(!/distribute_lead_weighted|record_assignment_notification/.test(store))
  })

  test('the claim still uses the function that has always been there', () => {
    assert.match(store, /rpc\('assign_lead_to'/)
  })

  test('a concurrent save is retried, not silently lost', () => {
    assert.match(store, /\.eq\('value', String\(version\)\)/)
    assert.match(store, /for \(let attempt = 0; attempt < CAS_ATTEMPTS; attempt\+\+\)/)
  })

  test('and if it truly cannot settle, it says why', () => {
    assert.match(store, /Somebody else was changing the allocation at the same time/)
  })
})

/* ══ 2. THE IMPORT ════════════════════════════════════════════════════════ */

describe('a source value the database rejects cannot reach it', () => {
  test('every source the app can produce is a real enum label', () => {
    const match = schema.match(/CREATE TYPE lead_source AS ENUM \(([\s\S]*?)\)/)
    assert.ok(match, 'the enum should be in the schema')
    const allowed = [...match![1].matchAll(/'([a-z_]+)'/g)].map(m => m[1])
    for (const s of LEAD_SOURCES) {
      assert.ok(allowed.includes(s),
        `the app may write source "${s}" but the database enum has only ${allowed.join(', ')}`)
    }
  })

  test('walk_in is mapped, not emitted', () => {
    // It was in the app's list and has never been in the enum, so those rows
    // failed the insert with "invalid input value for enum lead_source".
    assert.equal(resolveSource('walk_in'), 'manual')
    assert.equal(resolveSource('Walk In'), 'manual')
    assert.equal(resolveSource('walk-in'), 'manual')
    assert.ok(!(LEAD_SOURCES as readonly string[]).includes('walk_in'))
  })

  test('a genuine source is still preserved', () => {
    assert.equal(resolveSource('facebook'), 'facebook')
    assert.equal(resolveSource('  Referral '), 'referral')
    assert.equal(resolveSource(null), 'manual')
    assert.equal(resolveSource('something else'), 'manual')
  })
})

describe('an import is not abandoned because the run cannot be catalogued', () => {
  test('a missing catalogue no longer throws before any lead is read', () => {
    /*
     * lead_imports and next_import_reference come from migration 0011. When
     * that was unavailable the whole upload failed with "The import could not
     * be started" and every row was lost — for a bookkeeping row.
     */
    assert.match(importer, /let trackingAvailable = true/)
    assert.match(importer, /trackingAvailable = false/)
    assert.ok(!/if \(error \|\| !created\) throw new Error\(`Could not start the import/.test(importer))
  })

  test('the row outcomes are only written when there is somewhere to write them', () => {
    assert.match(importer, /if \(trackingAvailable\) \{[\s\S]{0,200}from\('lead_import_rows'\)/)
  })

  test('and the totals are not queried with an empty id', () => {
    // .eq('id', '') against a uuid column is itself an error.
    assert.match(importer, /const \{ data: current \} = trackingAvailable/)
    assert.match(importer, /if \(trackingAvailable\) \{[\s\S]{0,260}from\('lead_imports'\)\.update\(/)
  })

  test('the caller is told the leads landed but the run was not recorded', () => {
    assert.match(importer, /tracked: trackingAvailable/)
  })

  test('an imported lead with no named owner enters the configured pool', () => {
    assert.match(importer, /distributeLead\(lead\.id, candidates, \{ source: 'import' \}\)/)
    assert.ok(!/assign_lead_atomic/.test(importer),
      'a bulk import must not use the old least-loaded rule and undo the configured split')
  })

  test('a named owner in the file is still honoured first', () => {
    const named = importer.indexOf("rpc('assign_lead_to'")
    const pool = importer.indexOf('distributeLead(lead.id')
    assert.ok(named > -1 && named < pool)
    assert.match(importer, /candidates\.some\(c => c\.id === row\.assigned_to\)/)
  })

  test('a row that fails still reports the real reason', () => {
    assert.match(importer, /record\('failed', insErr\?\.message\?\.slice\(0, 300\)/)
  })
})

/* ══ 3. REGISTERED ════════════════════════════════════════════════════════ */

describe('an accountant can mark a lead registered', () => {
  test('the status is no longer hostage to crediting commission', () => {
    /*
     * program_points is the REMUNERATION table, not the course catalogue. The
     * route returned needsProgram BEFORE applying the status, so a lead whose
     * programme could not be matched never moved — and the operator was asked
     * to pick from a list that could be empty.
     */
    const ask = status.indexOf('needsProgram: true')
    const apply = status.indexOf("from('leads')\n    .update({ status })")
    assert.ok(ask > -1 && apply > -1, 'both branches should exist')
    assert.match(status, /if \(!prog && !courseKnown && !progErr && list\.length > 0\)/,
      'it may only ask when asking can actually be answered')
  })

  test('a failed read of the programmes is not "no programmes"', () => {
    assert.match(status, /const \{ data: programs, error: progErr \}/)
    assert.match(status, /if \(progErr\) \{[\s\S]{0,140}console\.error/)
  })

  test('a course the lead already names is reused, not re-asked', () => {
    assert.match(status, /let courseKnown = false/)
    assert.match(status, /from\('courses'\)/)
    assert.match(status, /courseKnown = true/)
  })

  test('the canonical course table is used, not a duplicate or a price column', () => {
    assert.ok(!/courses\.price|'price'/.test(status))
    assert.match(status, /\.ilike\('name'/)
    assert.match(status, /\.eq\('code', needle\)/)
  })

  test('the course lookup cannot be rewritten by the lead’s own text', () => {
    // A comma inside an .or() value starts a new condition.
    const block = status.slice(status.indexOf('let courseKnown'), status.indexOf('if (!prog && !courseKnown'))
    assert.ok(!/\.or\(/.test(block), 'free text must not be interpolated into an .or() filter')
  })

  test('a failed course lookup is not read as "no such course"', () => {
    assert.match(status, /if \(courseErr\) \{[\s\S]{0,160}console\.error/)
  })

  test('when no credit is possible the registration still stands, and says so', () => {
    assert.match(status, /let creditSkipped: string \| null = null/)
    assert.match(status, /creditSkipped = progErr/)
    assert.match(status, /credited: becomingRegistered && !creditSkipped/)
    assert.match(status, /creditSkipped,/)
  })

  test('the status write is still checked rather than assumed', () => {
    assert.match(status, /if \(statusErr \|\| !updated\)/)
    assert.match(status, /leads\.status_not_applied/)
  })

  test('double crediting is still prevented', () => {
    assert.match(status, /from\('marketer_enrollments'\)[\s\S]{0,120}\.eq\('lead_id', leadId\)/)
    assert.match(status, /if \(!already\)/)
  })
})

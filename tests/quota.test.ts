import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * A MEMBER'S TARGET.
 *
 * marketer_targets has been in the schema since schema-v3, with row level
 * security enabled on it, and NOTHING in the application ever referenced it.
 * A target could be neither set nor seen, so "what is my quota?" had no answer
 * anywhere in the portal, for anybody.
 *
 * This is the existing table, read and written. It is not a new quota model,
 * not a billing model, and not a cap: nothing refuses to assign a lead because
 * somebody reached their number.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const quota = codeOf('lib/leads/quota.ts')
const api = codeOf('app/api/marketer/quota/route.ts')
const dash = codeOf('app/api/marketer/dashboard/route.ts')
const screen = codeOf('app/(portal)/marketer/page.tsx')
const admin = codeOf('app/(portal)/admin/marketers/page.tsx')
const schema = readFileSync('supabase/FULL-SCHEMA.sql', 'utf8')

describe('it uses the table that already exists', () => {
  test('marketer_targets, not a new one', () => {
    assert.match(quota, /from\('marketer_targets'\)/)
    assert.match(api, /from\('marketer_targets'\)/)
  })

  test('and the columns that are actually on it', () => {
    const block = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS marketer_targets'))
    const cols = block.slice(0, block.indexOf(');'))
    for (const c of ['marketer_id', 'period', 'period_start', 'period_end', 'target_leads', 'target_conversions', 'set_by']) {
      assert.ok(cols.includes(c), `marketer_targets has no ${c}`)
    }
    for (const c of ['target_leads', 'period_start', 'period_end', 'set_by']) {
      assert.ok(api.includes(c), `the write never sets ${c}`)
    }
  })

  test('no second quota table is created', () => {
    assert.ok(!/CREATE TABLE/i.test(quota + api))
  })
})

describe('the numbers come from real records', () => {
  test('used is counted from assignment events, not current ownership', () => {
    /*
     * leads.assigned_to says who holds a lead now and changes on every
     * reassignment. The distribution dashboard counts the same events, so the
     * two screens cannot disagree about how many leads somebody got.
     */
    assert.match(quota, /from\('lead_assignments'\)/)
    assert.match(quota, /\.eq\('to_marketer', marketerId\)/)
    assert.match(quota, /count: 'exact', head: true/)
  })

  test('it is bounded to the period', () => {
    assert.match(quota, /\.gte\('created_at', `\$\{periodStart\}T00:00:00\.000Z`\)/)
    assert.match(quota, /\.lte\('created_at', `\$\{periodEnd\}T23:59:59\.999Z`\)/)
  })

  test('conversions come from the enrolments that already drive remuneration', () => {
    assert.match(quota, /from\('marketer_enrollments'\)/)
  })
})

describe('a failed read is never shown as a quota of zero', () => {
  test('a real error is reported', () => {
    assert.match(quota, /return \{ ok: false, reason: targetError\.message \}/)
    assert.match(quota, /if \(usedError\) return \{ ok: false, reason: usedError\.message \}/)
  })

  test('but a table that is not there is "no target set", which is a real state', () => {
    assert.match(quota, /const MISSING_TABLE = new Set\(\['42P01', 'PGRST205'\]\)/)
    assert.match(quota, /if \(targetError && !missing\(targetError\)\)/)
  })

  test('the dashboard says so rather than showing a zero target', () => {
    assert.match(dash, /quota: quotaRes\.ok \? quotaRes\.quota : null/)
    assert.match(dash, /quotaError: quotaRes\.ok \? null : 'Your target could not be loaded\.'/)
    assert.match(screen, /stats\.quotaError/)
  })

  test('and an unset target is not rendered as a target of zero', () => {
    assert.match(quota, /target: targetLeads/)
    assert.match(screen, /stats\.quota\.target !== null/)
    assert.match(screen, /No target has been set for you this period/)
  })
})

describe('the dashboard no longer hides its own failures', () => {
  test('a failed lead read is a 503, not an empty pipeline', () => {
    // Both errors used to be discarded, so a blip rendered as a marketer who
    // had done nothing all year.
    assert.match(dash, /if \(leadsRes\.error\) \{/)
    assert.match(dash, /if \(enrollRes\.error\) \{/)
    assert.match(dash, /status: 503/)
  })
})

describe('arithmetic', () => {
  test('remaining never goes negative', () => {
    // Exceeding a target leaves none remaining, not a debt.
    assert.match(quota, /Math\.max\(0, targetLeads - \(used \?\? 0\)\)/)
  })

  test('remaining is null when there is no target', () => {
    assert.match(quota, /remaining: targetLeads === null \? null :/)
  })

  test('the progress bar cannot exceed the bar', () => {
    assert.match(screen, /Math\.min\(100, Math\.round\(\(stats\.quota\.used \/ Math\.max\(1, stats\.quota\.target\)\) \* 100\)\)/)
  })
})

describe('a target is a target, not a cap', () => {
  test('nothing refuses to assign a lead because of it', () => {
    for (const path of ['lib/leads/distributionStore.ts', 'lib/autoAssign.ts', 'lib/leads/import.ts']) {
      assert.ok(!/marketer_targets|readQuota/.test(codeOf(path)),
        `${path} consults the target when deciding who receives a lead`)
    }
  })

  test('and the screens say so', () => {
    assert.match(screen, /this is a target, not a cap/)
    assert.match(admin, /A target, not a cap/)
  })
})

describe('who may set and see one', () => {
  test('managers set; a member sees only their own', () => {
    assert.match(api, /const MANAGERS = \['super_admin', 'project_manager', 'administrator'\]/)
    assert.match(api, /if \(asked && asked !== s\.userId && !MANAGERS\.includes\(s\.role \|\| ''\)\)/)
    assert.match(api, /You can only see your own target/)
  })

  test('the write is refused to everybody else', () => {
    const post = api.slice(api.indexOf('export async function POST'))
    assert.match(post, /if \(!MANAGERS\.includes\(s\.role \|\| ''\)\)/)
    assert.match(post, /status: 403/)
  })

  test('a target cannot be set for somebody who cannot receive leads', () => {
    assert.match(api, /if \(!await isEligible\(body\.marketerId\)\)/)
  })

  test('the change is audited', () => {
    assert.match(api, /action: 'marketer\.target_set'/)
  })
})

describe('setting a target twice does not leave two rows', () => {
  test('an existing row for the same period is updated', () => {
    // marketer_targets has no unique constraint to upsert against.
    assert.match(api, /const \{ data: existing, error: findError \}/)
    assert.match(api, /existing\s*\n?\s*\? await sb\.from\('marketer_targets'\)\.update\(row\)\.eq\('id', existing\.id\)/)
  })

  test('and a failed lookup does not become a duplicate insert', () => {
    assert.match(api, /if \(findError\) return unavailable\(/)
  })

  test('a backwards period is refused', () => {
    assert.match(api, /if \(periodEnd < periodStart\)/)
  })
})

describe('the screens', () => {
  test('the member sees theirs on the dashboard', () => {
    assert.match(screen, /Your target/)
    assert.match(screen, /to go/)
  })

  test('a manager sets it where they already look at that person', () => {
    assert.match(admin, /Set target/)
    assert.match(admin, /\/api\/marketer\/quota/)
  })

  test('the input does not make iOS zoom, and the control is tappable', () => {
    assert.match(admin, /text-\[16px\] sm:text-sm/)
    assert.match(admin, /min-h-\[44px\]/)
  })

  test('a refusal is shown, never announced as success', () => {
    const fn = admin.slice(admin.indexOf('async function saveTarget'))
    assert.match(fn.slice(0, 1200), /if \(!res\.ok \|\| !d\?\.success\)/)
    assert.match(fn.slice(0, 1200), /toast\.error\(d\?\.error/)
  })
})

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * WAITING LEADS ARE ASSIGNED — BY THE PERCENTAGES, ONCE EACH, AND ANNOUNCED ONCE.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const backlog = codeOf('lib/leads/backlog.ts')
const route = codeOf('app/api/leads/assign-unassigned/route.ts')
const sweep = codeOf('app/api/leads/sweep/route.ts')
const cron = codeOf('app/api/cron/run/route.ts')
const screen = codeOf('app/(portal)/admin/leads/page.tsx')

describe('the same rules as a lead arriving live', () => {
  test('a named owner is honoured before the pool', () => {
    const named = backlog.indexOf("p_reason: 'referral_link'")
    const pool = backlog.indexOf('await distributeLead(')
    assert.ok(named > -1 && named < pool)
    assert.match(backlog, /if \(lead\.referrer_id && eligible\.has\(lead\.referrer_id as string\)\)/)
  })

  test('everything else goes through the configured percentages', () => {
    assert.match(backlog, /distributeLead\(lead\.id as string, candidates/)
    assert.ok(!/autoAssignLead|assign_lead_atomic/.test(backlog),
      'the backlog must use the percentage engine, not the old path')
  })

  test('a lead that got an owner meanwhile keeps it', () => {
    assert.match(backlog, /p_force: false/)
    assert.match(backlog, /\.is\('assigned_to', null\)/)
  })

  test('longest-waiting first', () => {
    assert.match(backlog, /\.order\('created_at', \{ ascending: true \}\)/)
  })
})

describe('each person is told once', () => {
  test('not once per lead', () => {
    assert.ok(!/notifyLeadAssigned|onLeadAssigned/.test(backlog),
      'forty waiting leads must not become forty texts')
    assert.match(backlog, /await notifyImportBatch\(tally, `backlog-\$\{stamp\}`, 'backlog'\)/)
  })

  test('and the message says where they came from', () => {
    assert.match(codeOf('lib/leads/importNotify.ts'), /that were waiting to be assigned/)
  })
})

describe('it cannot time out half-way without saying so', () => {
  test('it stops inside its budget and reports what is left', () => {
    assert.match(backlog, /if \(Date\.now\(\) - started > budget\) break/)
    assert.match(backlog, /remaining: leads\.length - processed/)
  })

  test('the route is given the time it needs', () => {
    assert.match(route, /export const maxDuration = 60/)
  })
})

describe('failures are failures', () => {
  test('a failed read is not "no unassigned leads"', () => {
    assert.match(backlog, /if \(error\) return \{ ok: false, reason: `The unassigned leads could not be read/)
    assert.match(route, /if \(error\) return unavailable\(/)
  })

  test('the reasons leads were not assigned are returned', () => {
    assert.match(backlog, /reasons\.add\(outcome\.failure\)/)
  })

  test('the button no longer calls nothing a success', () => {
    // "Assigned 0 lead(s)" in green when every assignment had failed.
    assert.ok(!/toast\.success\(`Assigned \$\{d\.assigned\} lead\(s\)\.`/.test(screen))
    assert.match(screen, /if \(d\.failed > 0\) toast\.error/)
    assert.match(screen, /if \(d\.remaining > 0\)/)
  })
})

describe('who may run it', () => {
  test('super admin and project manager, or the scheduler', () => {
    assert.match(route, /const ALLOWED = \['super_admin', 'project_manager'\]/)
    assert.match(route, /if \(isValidCronRequest\(req\)\) return 'scheduler'/)
  })

  test('the scheduler defers to the Settings switch; a person does not', () => {
    assert.match(route, /respectToggle: who === 'scheduler'/)
  })

  test('the sweep is scheduler-only', () => {
    assert.match(sweep, /if \(!isValidCronRequest\(req\)\) return NextResponse\.json\(\{ error: 'unauth' \}, \{ status: 401 \}\)/)
  })
})

describe('the safety net runs on its own', () => {
  test('it is scheduled, and first', () => {
    assert.match(cron, /\{ name: 'lead_sweep',\s+path: '\/api\/leads\/sweep',\s+everyMins: 10 \}/)
    const tasks = cron.slice(cron.indexOf('const TASKS'))
    assert.ok(tasks.indexOf("'lead_sweep'") < tasks.indexOf("'sms_queue'"))
  })

  test('the middleware lets the scheduler reach it', () => {
    /*
     * Without this the fan-out's request is refused by proxy.ts before the
     * route ever sees its secret — the safety net would have been scheduled
     * and never run. The route verifies the secret itself, like every other
     * entry on the list.
     */
    assert.match(readFileSync('proxy.ts', 'utf8'), /'\/api\/leads\/sweep',/)
  })

  test('it leaves brand-new leads to the live path', () => {
    assert.match(sweep, /minAgeMinutes: 5/)
  })
})

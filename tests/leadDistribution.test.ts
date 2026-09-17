import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  pickWeighted, simulate, validateAllocations, varianceFor, round2, type Member,
} from '../lib/leads/distribution.ts'

/**
 * LEAD DISTRIBUTION.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * 1. No percentage was ever configurable. Weight came from one of four
 *    hard-coded performance tiers, and no screen could set a person's share.
 *
 * 2. The weight was not applied to share of new leads anyway. Selection
 *    ordered by `open_leads / weight`, so clearing your pipeline earned you
 *    the next lead and letting leads sit starved you. Distribution was
 *    decided by working speed, not by any configured number.
 *
 * 3. The lock was on the lead row, which is not the contended resource. Two
 *    different leads arriving together read the same state and picked the
 *    same person.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const sql = readFileSync('supabase/migrations/0021_lead_distribution.sql', 'utf8')
const store = codeOf('lib/leads/distributionStore.ts')
const engine = codeOf('lib/autoAssign.ts')
const eligibility = codeOf('lib/leads/eligibility.ts')
const api = codeOf('app/api/leads/distribution/route.ts')
const screen = codeOf('components/leads/LeadDistribution.tsx')
const dataRoute = codeOf('app/api/data/route.ts')

const M = (id: string, pct: number, cw = 0): Member =>
  ({ id, allocationPercent: pct, currentWeight: cw })

/* ══ PERCENTAGE ═══════════════════════════════════════════════════════════ */

describe('the configured percentages are the distribution', () => {
  test('50/30/20 over 100 leads lands exactly', () => {
    const got = simulate([M('isaac', 50), M('mary', 30), M('john', 20)], 100)
    assert.deepEqual(got, { isaac: 50, mary: 30, john: 20 })
  })

  test('40/40/20 over 100 leads lands exactly', () => {
    const got = simulate([M('isaac', 40), M('mary', 40), M('john', 20)], 100)
    assert.deepEqual(got, { isaac: 40, mary: 40, john: 20 })
  })

  test('one person on 100% receives everything', () => {
    assert.deepEqual(simulate([M('solo', 100)], 50), { solo: 50 })
  })

  test('a zero share receives nothing, however long the run', () => {
    const got = simulate([M('a', 100), M('idle', 0)], 200)
    assert.equal(got.idle, 0)
    assert.equal(got.a, 200)
  })

  test('an uneven split still converges, not just a tidy one', () => {
    // 1/3 does not divide 100, so this is the case a naive counter drifts on.
    const got = simulate([M('a', 33.34), M('b', 33.33), M('c', 33.33)], 300)
    for (const id of ['a', 'b', 'c']) {
      assert.ok(Math.abs(got[id] - 100) <= 1, `${id} got ${got[id]}, expected about 100`)
    }
  })
})

describe('an inactive person is excluded, and their state is kept', () => {
  test('a zero-weight member is never chosen', () => {
    const pick = pickWeighted([M('off', 0), M('on', 100)])
    assert.equal(pick?.chosen, 'on')
  })

  test('nobody at all is a real answer, not an arbitrary pick', () => {
    assert.equal(pickWeighted([]), null)
    assert.equal(pickWeighted([M('off', 0)]), null)
  })

  test('switching somebody off does not hand them a backlog on return', () => {
    /*
     * Their carried weight is preserved rather than accumulating while they
     * are off. Otherwise re-enabling somebody would drain the whole pool onto
     * them for the next several leads.
     */
    const pick = pickWeighted([M('off', 0, -12), M('on', 100)])
    const off = pick?.nextState.find(s => s.id === 'off')
    assert.equal(off?.currentWeight, -12, 'an inactive member’s state must be untouched')
  })

  test('the remaining active members absorb the freed share', () => {
    const got = simulate([M('a', 60), M('b', 40)], 100)
    assert.deepEqual(got, { a: 60, b: 40 })
  })
})

describe('invalid allocations are refused', () => {
  const ok = { isActive: true }

  test('a negative share', () => {
    const issues = validateAllocations([{ id: 'a', allocationPercent: -5, ...ok }])
    assert.ok(issues.some(i => /cannot be negative/.test(i.message)))
  })

  test('more than 100', () => {
    const issues = validateAllocations([{ id: 'a', allocationPercent: 120, ...ok }])
    assert.ok(issues.some(i => /more than 100/.test(i.message)))
  })

  test('a total that is not 100', () => {
    const issues = validateAllocations([
      { id: 'a', allocationPercent: 50, ...ok },
      { id: 'b', allocationPercent: 30, ...ok },
    ])
    assert.ok(issues.some(i => i.field === 'total' && /must total 100%/.test(i.message)))
  })

  test('a total of exactly 100 passes', () => {
    assert.deepEqual(validateAllocations([
      { id: 'a', allocationPercent: 50, ...ok },
      { id: 'b', allocationPercent: 30, ...ok },
      { id: 'c', allocationPercent: 20, ...ok },
    ]), [])
  })

  test('inactive members are not counted towards the total', () => {
    assert.deepEqual(validateAllocations([
      { id: 'a', allocationPercent: 100, isActive: true },
      { id: 'b', allocationPercent: 40, isActive: false },
    ]), [])
  })

  test('the same person twice is refused', () => {
    const issues = validateAllocations([
      { id: 'a', allocationPercent: 50, ...ok },
      { id: 'a', allocationPercent: 50, ...ok },
    ])
    assert.ok(issues.some(i => /more than once/.test(i.message)))
  })

  test('and the database makes a duplicate impossible anyway', () => {
    assert.match(sql, /profile_id\s+UUID PRIMARY KEY REFERENCES profiles\(id\)/)
  })

  test('the bounds are enforced in the schema too, not only in the screen', () => {
    assert.match(sql, /CHECK \(allocation_percent >= 0 AND allocation_percent <= 100\)/)
  })

  test('nothing is silently normalised', () => {
    // The rule is stated and enforced; the screen previews the real outcome
    // instead of rescaling behind the operator.
    assert.match(screen, /simulate\(members, 20\)/)
    assert.match(screen, /Nothing is normalised behind you/)
  })
})

/* ══ ALGORITHM ════════════════════════════════════════════════════════════ */

describe('the algorithm behaves as a scheduler must', () => {
  test('it is deterministic', () => {
    const a = simulate([M('x', 50), M('y', 30), M('z', 20)], 37)
    const b = simulate([M('x', 50), M('y', 30), M('z', 20)], 37)
    assert.deepEqual(a, b)
  })

  test('ties break on id, so concurrent equals are still reproducible', () => {
    assert.equal(pickWeighted([M('b', 50), M('a', 50)])?.chosen, 'a')
  })

  test('it is smooth — nobody waits a whole cycle for a first lead', () => {
    const state = [M('a', 50), M('b', 30), M('c', 20)]
    const seq: string[] = []
    for (let i = 0; i < 10; i++) {
      const p = pickWeighted(state)!
      seq.push(p.chosen)
      const by = new Map(p.nextState.map(s => [s.id, s.currentWeight]))
      for (const m of state) m.currentWeight = by.get(m.id)!
    }
    assert.ok(seq.slice(0, 3).includes('c'), `c starved at the start: ${seq.join(' ')}`)
    assert.ok(!/^(\w+) \1 \1 \1/.test(seq.join(' ')), `not smooth: ${seq.join(' ')}`)
  })

  test('nobody with a share is ever starved indefinitely', () => {
    const got = simulate([M('big', 99), M('tiny', 1)], 300)
    assert.ok(got.tiny >= 2, `a 1% share received ${got.tiny} of 300`)
  })

  test('drift is corrected rather than allowed to wander', () => {
    // Start from a badly skewed state; the deficit must pull it back.
    const got = simulate([M('a', 50, -200), M('b', 50, 200)], 100)
    assert.ok(Math.abs(got.a - got.b) <= 4,
      `drift not corrected: a=${got.a} b=${got.b}`)
  })

  test('changing the weights transitions without a burst', () => {
    /*
     * Carry the state from a 50/30/20 run into a 40/40/20 configuration and
     * check the new shares take effect without one person taking a run of
     * leads to "catch up".
     */
    const state = [M('a', 50), M('b', 30), M('c', 20)]
    for (let i = 0; i < 50; i++) {
      const p = pickWeighted(state)!
      const by = new Map(p.nextState.map(s => [s.id, s.currentWeight]))
      for (const m of state) m.currentWeight = by.get(m.id)!
    }
    const carried = state.map(m => ({ ...m, allocationPercent: m.id === 'a' ? 40 : m.id === 'b' ? 40 : 20 }))
    const after = simulate(carried, 100)
    assert.ok(Math.abs(after.a - 40) <= 2, `a=${after.a}`)
    assert.ok(Math.abs(after.b - 40) <= 2, `b=${after.b}`)
    assert.ok(Math.abs(after.c - 20) <= 2, `c=${after.c}`)
  })

  test('the total returned to the winner is the pool, which is what makes it exact', () => {
    const pick = pickWeighted([M('a', 50), M('b', 30), M('c', 20)])!
    const a = pick.nextState.find(s => s.id === 'a')!
    // a accrues 50 then pays back 100.
    assert.equal(a.currentWeight, -50)
  })
})

describe('the state survives everything it has to', () => {
  test('it lives in a table, not in memory', () => {
    assert.match(sql, /current_weight\s+NUMERIC\(14,4\) NOT NULL DEFAULT 0/)
  })

  test('the engine holds no module-level allocation state', () => {
    for (const [name, src] of [['store', store], ['engine', engine]] as const) {
      assert.ok(!/^let\s+\w*(weight|rotation|cursor|counter|lastPick)/im.test(src),
        `${name} keeps allocation state in process memory, which a second instance would not share`)
    }
  })

  test('nothing about allocation touches browser storage', () => {
    assert.ok(!/localStorage|sessionStorage/.test(screen))
  })

  test('the decision and the write happen in one database call', () => {
    assert.match(store, /rpc\('distribute_lead_weighted'/)
  })
})

describe('concurrency is handled where it is actually contended', () => {
  test('the member rows are locked, not just the lead row', () => {
    /*
     * The original bug. Locking the lead serialises two assignments of the
     * SAME lead — never the contended case. Two different leads arriving
     * together both read the same member state and chose the same person.
     */
    assert.match(sql, /FROM lead_distribution_members m[\s\S]{0,400}FOR UPDATE OF m/)
  })

  test('rows are locked in a fixed order, so callers cannot deadlock', () => {
    const block = sql.slice(sql.indexOf('THE LOCK THAT MATTERS'))
    assert.match(block.slice(0, 900), /ORDER BY m\.profile_id[\s\S]{0,60}FOR UPDATE/)
  })

  test('an already-owned lead is returned, never reassigned', () => {
    assert.match(sql, /IF v_current IS NOT NULL THEN[\s\S]{0,200}'already_assigned'/)
  })

  test('the lead row is still locked, so one lead cannot be claimed twice', () => {
    assert.match(sql, /SELECT assigned_to INTO v_current FROM leads WHERE id = p_lead_id FOR UPDATE/)
  })

  test('no JavaScript lock is relied on', () => {
    assert.ok(!/mutex|Semaphore|acquireLock|new Lock/i.test(store + engine))
  })
})

/* ══ ASSIGNMENT ═══════════════════════════════════════════════════════════ */

describe('a lead is assigned once, or is detectably unassigned', () => {
  test('the assignment and its audit row are written together', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION distribute_lead_weighted'))
    assert.match(fn, /UPDATE leads[\s\S]{0,200}SET assigned_to = v_chosen/)
    assert.match(fn, /INSERT INTO lead_assignments/)
  })

  test('a failure leaves the lead unassigned and says so', () => {
    assert.match(store, /failure: `distribute_lead_weighted failed: \$\{error\.message\}`/)
    assert.match(engine, /if \(outcome\.failure\) \{[\s\S]{0,200}console\.error/)
  })

  test('a database error is never reported as "nobody was eligible"', () => {
    assert.match(eligibility, /if \(error\) \{[\s\S]{0,200}throw new Error/)
    assert.match(engine, /could not build the candidate pool/)
  })

  test('the unassigned count is read, not estimated', () => {
    assert.match(api, /\.is\('assigned_to', null\)/)
    assert.match(api, /count: 'exact', head: true/)
  })

  test('no failure path returns success', () => {
    // Requirement 22, asserted rather than trusted.
    for (const [name, src] of [['store', store], ['api', api]] as const) {
      assert.ok(!/catch\s*\([^)]*\)\s*\{\s*return\s*(NextResponse\.json\(\{\s*success:\s*true|\{\s*ok:\s*true)/.test(src),
        `${name} swallows a failure and reports success`)
    }
  })

  test('a failed statistics read is surfaced, not shown as zero', () => {
    assert.match(api, /if \(eventError\) \{[\s\S]{0,150}return unavailable\(/)
    assert.match(api, /if \(unassignedError\) \{[\s\S]{0,150}return unavailable\(/)
  })
})

/* ══ ATTRIBUTION ══════════════════════════════════════════════════════════ */

describe('direct attribution is not overridden by the shared pool', () => {
  test('a named owner is honoured before the pool is ever consulted', () => {
    const named = engine.indexOf('preferredMarketerId && await isEligible')
    const pool = engine.indexOf('distributeLead(leadId, candidates')
    assert.ok(named > -1 && named < pool,
      'the referral/marketing owner must be claimed before weighted distribution')
  })

  test('it is claimed with its own reason, so history tells them apart', () => {
    assert.match(engine, /p_reason: 'referral_link'/)
  })

  test('an owned lead is never stolen by the distributor', () => {
    assert.match(engine, /p_force: false,\s+\/\/ never steal a lead that is already owned|p_force: false/)
    assert.match(sql, /IF v_current IS NOT NULL THEN/)
  })

  test('an ineligible named owner falls through rather than parking the lead', () => {
    assert.match(engine, /if \(preferredMarketerId && await isEligible\(preferredMarketerId\)\)/)
  })

  test('the marketing link still passes its owner into intake', () => {
    const intake = codeOf('lib/leadIntake.ts')
    assert.match(intake, /autoAssignLead\(lead\.id, input\.preferredMarketerId, input\.source\)/)
  })

  test('and the registration path still passes the application’s marketer', () => {
    const link = codeOf('lib/registration/linkLead.ts')
    assert.match(link, /autoAssignLead\(resolvedLeadId, app\.marketer_id \|\| null, 'website'\)/)
  })
})

/* ══ NOTIFICATIONS ════════════════════════════════════════════════════════ */

describe('notification is separate from assignment', () => {
  test('onLeadAssigned runs after the assignment is committed', () => {
    const assignIdx = engine.indexOf('await distributeLead')
    const notifyIdx = engine.indexOf('await onLeadAssigned(leadId, outcome.chosen)')
    assert.ok(assignIdx > -1 && assignIdx < notifyIdx)
  })

  test('a failed notification cannot unassign the lead', () => {
    const fn = engine.slice(engine.indexOf('export async function onLeadAssigned'))
    assert.ok(!/assigned_to:\s*null|\.update\(\{\s*assigned_to/.test(fn),
      'nothing in the notification path may clear the assignment')
  })

  test('the outcome is recorded, success or failure', () => {
    assert.match(engine, /recordNotificationOutcome\(leadId, marketerId, !notifyError, notifyError\?\.message\)/)
    assert.match(sql, /CREATE OR REPLACE FUNCTION record_assignment_notification/)
  })

  test('a failure is never written as delivered', () => {
    assert.match(engine, /const \{ error: notifyError \} = await sb\.from\('notifications'\)\.insert/)
    assert.ok(!/notified: true/.test(engine), 'success must be derived from the write, not asserted')
  })

  test('and the screen shows which leads were assigned but unannounced', () => {
    assert.match(screen, /Assigned, but the notification failed/)
  })
})

/* ══ PORTAL VISIBILITY ════════════════════════════════════════════════════ */

describe('an assigned lead reaches the right staff portal', () => {
  test('there is one identity: the session id is the profile id', () => {
    const verify = codeOf('app/api/auth/verify-pin/route.ts')
    assert.match(verify, /createSession\(profile\.id/)
  })

  test('and it is what leads are scoped by', () => {
    assert.match(dataRoute, /const userId = ctx\.session\.userId/)
    assert.match(dataRoute, /if \(ownerCol\) query = query\.eq\(ownerCol, userId\)/)
    assert.match(codeOf('lib/data/policy.ts'), /if \(table === 'leads'\) return leadAccessFor\(role, portals\) === 'own' \? 'assigned_to' : null/)
  })

  test('scoping is applied whatever filters the caller sends', () => {
    const idx = dataRoute.indexOf('const ownerCol = ownerColumnFor')
    const filters = dataRoute.indexOf('for (const { col, op = \'eq\', val } of parseFilters')
    assert.ok(idx > -1 && idx < filters, 'the scope must be applied before caller filters')
  })

  test('a caller cannot widen their own scope', () => {
    assert.match(dataRoute, /if \(ownerCol && col === ownerCol\) continue/)
  })

  test('a failed lead query is an error, never an empty list', () => {
    assert.match(dataRoute, /if \(error\) \{[\s\S]{0,220}status: 500/)
  })

  test('the marketer page waits for its identity instead of querying without one', () => {
    const page = codeOf('app/(portal)/marketer/leads/page.tsx')
    assert.match(page, /enabled: !!myId/)
    assert.match(page, /filters: myId \? \[\{ col: 'assigned_to', op: 'eq', val: myId \}\] : \[\]/)
  })

  test('leads held by somebody with no leads page are counted and reported', () => {
    // This is what "the lead disappeared" actually is, so it gets a number.
    assert.match(api, /if \(!eligibleIds\.has\(id\)\) strandedBy\[id\]/)
    assert.match(screen, /no longer eligible/)
  })
})

/* ══ AUDIT ════════════════════════════════════════════════════════════════ */

describe('every decision and every change is recorded', () => {
  test('the assignment records how it was decided', () => {
    assert.match(sql, /method, weight_at_assignment, pool_size, campaign/)
  })

  test('history extends the existing table rather than adding a second one', () => {
    assert.match(sql, /ALTER TABLE lead_assignments\s+ADD COLUMN IF NOT EXISTS method/)
    assert.ok(!/CREATE TABLE IF NOT EXISTS lead_distribution_events/.test(sql),
      'lead_assignments already records assignments; a second history table would duplicate it')
  })

  test('a configuration change records who, and from what to what', () => {
    assert.match(api, /action: 'leads\.distribution_changed'/)
    assert.match(api, /fromPercent: was\?\.allocationPercent \?\? null/)
    assert.match(api, /toPercent: r\.allocationPercent/)
    assert.match(api, /actorId: session\.userId/)
  })

  test('the previous values are read before the write, not after', () => {
    const before = api.indexOf('const before = await readDistributionConfig')
    const write = api.indexOf('const saved = await saveDistributionConfig')
    assert.ok(before > -1 && before < write)
  })

  test('history is never rewritten when the configuration changes', () => {
    assert.ok(!/UPDATE lead_assignments\s+SET (method|weight_at_assignment)/.test(sql),
      'past assignments must keep the weight that actually decided them')
    const save = api.slice(api.indexOf('export async function POST'))
    assert.ok(!/from\('leads'\)[\s\S]{0,120}\.update\(/.test(save),
      'saving an allocation must not touch existing leads')
  })

  test('saving does not reset the carried state and cause a burst', () => {
    assert.ok(!/current_weight:\s*0/.test(store.slice(store.indexOf('saveDistributionConfig'))),
      'resetting current_weight on save would hand the next cycle to one person')
  })
})

/* ══ PERMISSIONS ══════════════════════════════════════════════════════════ */

describe('who may see and change it', () => {
  test('super admin and project manager, and nobody else', () => {
    assert.match(api, /const ALLOWED_ROLES = \['super_admin', 'project_manager'\]/)
    assert.match(codeOf('app/api/leads/distribution/history/route.ts'),
      /const ALLOWED_ROLES = \['super_admin', 'project_manager'\]/)
  })

  test('both GET and POST are guarded', () => {
    const get = api.slice(api.indexOf('export async function GET'), api.indexOf('const Body'))
    const post = api.slice(api.indexOf('export async function POST'))
    for (const [name, src] of [['GET', get], ['POST', post]] as const) {
      assert.match(src, /const session = await guard\(req\)/, `${name} is unguarded`)
      assert.match(src, /status: 403/, `${name} does not refuse`)
    }
  })

  test('the PM gains no wider powers than this screen', () => {
    // The route touches distribution only; it must not write leads or profiles.
    assert.ok(!/from\('profiles'\)[\s\S]{0,80}\.(update|insert|delete)\(/.test(api))
    assert.ok(!/from\('leads'\)[\s\S]{0,80}\.(update|insert|delete)\(/.test(api))
  })

  test('a share cannot be given to somebody who cannot hold a lead', () => {
    assert.match(api, /if \(!eligibleIds\.has\(r\.profileId\)\)/)
  })

  test('the table is not readable straight from the browser', () => {
    assert.match(sql, /ALTER TABLE lead_distribution_members ENABLE ROW LEVEL SECURITY/)
    assert.match(sql, /REVOKE ALL ON FUNCTION distribute_lead_weighted[\s\S]{0,120}FROM PUBLIC, anon, authenticated/)
  })
})

/* ══ STATISTICS ═══════════════════════════════════════════════════════════ */

describe('the dashboard figures mean what they say', () => {
  test('variance is actual share minus configured share', () => {
    const v = varianceFor(38, 100, 40)
    assert.equal(v.expected, 40)
    assert.equal(v.actualShare, 38)
    assert.equal(v.variance, -2)
  })

  test('an empty period does not divide by zero', () => {
    assert.deepEqual(varianceFor(0, 0, 40), { expected: 0, actualShare: 0, variance: -40 })
  })

  test('the figures come from assignment events, not current ownership', () => {
    /*
     * leads.assigned_to says who holds a lead now and changes on every
     * reassignment; a share is a statement about what was handed out.
     */
    assert.match(api, /from\('lead_assignments'\)/)
    const stats = api.slice(api.indexOf('let eventQuery'), api.indexOf('const totalAssigned'))
    assert.ok(!/from\('leads'\)/.test(stats))
  })

  test('the period actually filters', () => {
    assert.match(api, /if \(since\) eventQuery = eventQuery\.gte\('created_at', since\)/)
    assert.match(api, /today: 0, '7d': 7, '30d': 30, '90d': 90, all: null/)
  })

  test('an unknown period is refused rather than silently treated as all time', () => {
    assert.match(api, /if \(!\(period in PERIODS\)\)[\s\S]{0,120}status: 400/)
  })

  test('rounding is to two places and shared, not restated per call site', () => {
    assert.equal(round2(33.336), 33.34)
    assert.match(api, /round2\(/)
  })
})

/* ══ ROLLOUT SAFETY ═══════════════════════════════════════════════════════ */

describe('deploying the code before the migration cannot stop lead assignment', () => {
  test('a missing function is detected by its code, not by catching everything', () => {
    assert.match(store, /const MISSING_FUNCTION = new Set\(\['42883', 'PGRST202'\]\)/)
    assert.match(store, /if \(!missing\) \{[\s\S]{0,240}failure:/)
  })

  test('and falls back to the previous engine rather than dropping the lead', () => {
    assert.match(store, /rpc\('assign_lead_atomic'/)
    assert.match(store, /degraded: true/)
  })

  test('the degraded state is logged and shown, not hidden', () => {
    assert.match(engine, /migration 0021 has not been applied/)
    assert.match(screen, /Distribution engine not installed yet/)
  })

  test('a missing members table does not read as "everyone on zero"', () => {
    assert.match(store, /const MISSING_TABLE = new Set\(\['42P01', 'PGRST205'\]\)/)
    assert.match(store, /return \{ ok: false, reason: error\.message \}/)
  })

  test('an unconfigured pool still distributes, and says it is unconfigured', () => {
    assert.match(sql, /v_method := 'equal_fallback'/)
    assert.match(screen, /No shares configured/)
  })
})

/* ══ MOBILE ═══════════════════════════════════════════════════════════════ */

describe('it is usable on a phone', () => {
  test('the table is replaced by cards below md, not scrolled sideways', () => {
    assert.match(screen, /hidden md:block/)
    assert.match(screen, /md:hidden divide-y/)
    assert.ok(!/overflow-x-auto[^\n]*<table|table[^\n]*overflow-x-auto/.test(screen))
  })

  test('the number input does not make iOS zoom', () => {
    const input = screen.slice(screen.indexOf('function PercentInput'))
    assert.match(input, /text-\[16px\]/)
  })

  test('the save bar clears the mobile tab bar', () => {
    assert.match(screen, /bottom-\[calc\(var\(--tabbar-h\)\+12px\)\]/)
  })

  test('it is reachable from the navigation for both roles', () => {
    const nav = codeOf('lib/nav/model.ts')
    assert.match(nav, /\{ label: 'Lead distribution', href: '\/admin\/settings\/lead-distribution' \}/)
    assert.match(nav, /\{ label: 'Lead distribution', href: '\/pm\/lead-distribution' \}/)
  })

  test('and both paths fall inside an existing portal', () => {
    const portals = codeOf('lib/access/portals.ts')
    assert.match(portals, /settings:\s*\['\/admin\/settings'/)
    assert.match(portals, /pm_leads:\s*\['\/pm'/)
  })
})

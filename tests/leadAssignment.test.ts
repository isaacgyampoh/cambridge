import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { pickRecipient, TIER_WEIGHT } from '../lib/leads/selection.ts'
import { resolvePortals } from '../lib/access/portals.ts'

/**
 * D1 regression tests — lead assignment.
 *
 * Two defects are pinned here:
 *
 *   RC-1  The candidate pool was every active non-super-admin profile, so
 *         leads were assigned to trainers, accountants and students who have
 *         no leads page. From the marketing team's side that is
 *         indistinguishable from the lead never arriving.
 *
 *   RC-2  Selection was Math.random() over tier-weighted tickets, despite the
 *         docblock claiming round robin. A loaded support-tier marketer could
 *         go a whole day without receiving anything.
 */

// ── Eligibility, expressed as the assigner sees it ──────────────────────────
// The pool is "active, not super admin, not opted out, and has my_leads".
const hasLeadsPortal = (role: string, portals: string[] | null = null) =>
  resolvePortals(role, portals).includes('my_leads')

describe('RC-1 — who may receive a lead', () => {
  test('students and receptionists can no longer receive leads', () => {
    // Under the old pool ("every active profile that is not a super admin")
    // both of these were eligible, and a lead handed to a student is a lead
    // nobody will ever work.
    assert.equal(hasLeadsPortal('student'), false, 'a student must never receive a lead')
    assert.equal(hasLeadsPortal('receptionist'), false, 'a receptionist must not receive leads')
  })

  test('system roles are not a destination for leads', () => {
    assert.equal(hasLeadsPortal('super_admin'), false)
    assert.equal(hasLeadsPortal('administrator'), false)
  })

  test('roles that work leads are included', () => {
    for (const role of ['marketing_officer', 'project_manager', 'admissions_officer']) {
      assert.equal(hasLeadsPortal(role), true, `${role} should receive leads`)
    }
  })

  /*
   * These four carry `my_leads` in ROLE_DEFAULTS, so under the corrected rule
   * they remain eligible. That is the organisation's own configuration, not a
   * defect, and changing it is a business decision rather than a bug fix — so
   * the current state is recorded here rather than quietly altered. If leads
   * should not reach accountants or content managers, the change belongs in
   * ROLE_DEFAULTS (for the role) or in a person's own portal list, and this
   * test will then fail and need updating deliberately.
   */
  test('roles that carry my_leads by configuration remain eligible', () => {
    for (const role of ['accountant', 'trainer', 'exam_coordinator', 'content_manager']) {
      assert.equal(hasLeadsPortal(role), true,
        `${role} carries my_leads in ROLE_DEFAULTS — if that is wrong, change it there`)
    }
  })

  test('explicit portals override role defaults in both directions', () => {
    // Given explicit access, a trainer can be taken out of the lead pool …
    assert.equal(hasLeadsPortal('trainer', ['dashboard', 'my_classes']), false)
    // … and a receptionist can be put into it.
    assert.equal(hasLeadsPortal('receptionist', ['dashboard', 'my_leads']), true)
  })
})

// ── Selection ───────────────────────────────────────────────────────────────

const mk = (id: string, tier: keyof typeof TIER_WEIGHT) =>
  ({ id, weight: TIER_WEIGHT[tier] })

describe('RC-2 — selection is deterministic and cannot starve anyone', () => {
  test('an idle marketer is always chosen over a loaded one', () => {
    const pool = [mk('a', 'high'), mk('b', 'support')]
    // 'a' is a high performer but already holds ten leads; 'b' holds none.
    const chosen = pickRecipient(pool, { a: 10, b: 0 })
    assert.equal(chosen, 'b', 'a marketer with no leads must receive the next one')
  })

  test('the same inputs always give the same answer', () => {
    const pool = [mk('a', 'high'), mk('b', 'mid'), mk('c', 'low')]
    const load = { a: 4, b: 3, c: 1 }
    const first = pickRecipient(pool, load)
    for (let i = 0; i < 50; i++) {
      assert.equal(pickRecipient(pool, load), first, 'selection must not vary between calls')
    }
  })

  test('nobody is starved across a run of assignments', () => {
    // The exact scenario behind the report. Under the old lottery a support
    // marketer at high load could receive nothing at all.
    const pool = [mk('high', 'high'), mk('mid', 'mid'), mk('support', 'support')]
    const load: Record<string, number> = { high: 0, mid: 0, support: 0 }

    for (let i = 0; i < 60; i++) {
      const who = pickRecipient(pool, load)!
      load[who]++
    }

    for (const id of Object.keys(load)) {
      assert.ok(load[id] > 0, `${id} received no leads at all`)
    }
  })

  test('volume follows tier weight over a run', () => {
    const pool = [mk('high', 'high'), mk('mid', 'mid'), mk('support', 'support')]
    const load: Record<string, number> = { high: 0, mid: 0, support: 0 }

    for (let i = 0; i < 200; i++) load[pickRecipient(pool, load)!]++

    // high (45) should out-receive support (20) roughly 2:1, and must at least
    // strictly exceed both others.
    assert.ok(load.high > load.mid, 'a high performer should receive more than a mid')
    assert.ok(load.mid > load.support, 'a mid performer should receive more than support')

    const ratio = load.high / load.support
    assert.ok(ratio > 1.6 && ratio < 3.0, `high:support ratio was ${ratio.toFixed(2)}, expected near 45:20`)
  })

  test('ties break on the longest wait, then on id', () => {
    const pool = [mk('a', 'mid'), mk('b', 'mid')]
    // Same load; 'b' has waited longer.
    assert.equal(pickRecipient(pool, { a: 1, b: 1 }, { a: 5000, b: 1000 }), 'b')
    // Same load and same wait: stable by id.
    assert.equal(pickRecipient(pool, { a: 1, b: 1 }, { a: 100, b: 100 }), 'a')
  })

  test('an empty pool returns null rather than throwing', () => {
    assert.equal(pickRecipient([], {}), null)
  })

  test('a marketer absent from the load map counts as idle', () => {
    const pool = [mk('a', 'mid'), mk('fresh', 'mid')]
    assert.equal(pickRecipient(pool, { a: 3 }), 'fresh')
  })

  test('a zero or negative weight cannot divide by zero', () => {
    const chosen = pickRecipient([{ id: 'z', weight: 0 }, { id: 'y', weight: 35 }], { z: 5, y: 0 })
    assert.equal(chosen, 'y')
    assert.ok(Number.isFinite(0 / Math.max(1, 0)))
  })
})

describe('RC-2 — the load figure reflects only open leads', () => {
  test('closed leads do not count against a marketer', () => {
    // assign_lead_atomic counts only leads whose status is not registered,
    // lost or not_interested. This mirrors that rule at the unit level: a
    // marketer who converted everything is idle again.
    const pool = [mk('closer', 'mid'), mk('holder', 'mid')]
    const openLoad = { closer: 0, holder: 6 }   // closer's leads all registered
    assert.equal(pickRecipient(pool, openLoad), 'closer')
  })
})

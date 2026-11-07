import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mayReceiveLeads, NEVER_RECEIVES_LEADS, LEADS_PORTAL } from '../lib/leads/mayReceiveLeads.ts'
import { ROLE_DEFAULTS } from '../lib/access/portals.ts'

/**
 * TRAINERS ARE NOT GIVEN LEADS.
 *
 * ── WHAT WAS HAPPENING ─────────────────────────────────────────────────────
 *
 * `my_leads` was in the trainer role's defaults, and eligibility for the
 * distribution pool is "active, not a super admin, not opted out, and your
 * portals include my_leads". So every trainer was in the pool: assigned leads
 * by the live distributor, by the spreadsheet import and by the backlog
 * sweep, texted and emailed about them, and counted in the distribution
 * percentages — which takes leads away from the people whose job is to
 * convert them and leaves them on a dashboard nobody is working.
 *
 * ── WHY THE DEFAULTS ALONE WERE NOT ENOUGH ─────────────────────────────────
 *
 * resolvePortals ignores a role's defaults entirely once somebody has been
 * configured by hand: a saved portal list IS their access. Most long-serving
 * staff have been configured, so changing ROLE_DEFAULTS would have fixed the
 * rule for trainers hired afterwards and left every current trainer in the
 * pool — which is the whole of the complaint.
 */

const trainer = (portals: string[] | null = null) => ({ role: 'trainer', portals })

describe('a trainer is never given a lead', () => {
  test('not with the role defaults', () => {
    assert.equal(mayReceiveLeads(trainer()), false)
  })

  test('and not with a saved portal list that still includes the leads portal', () => {
    /*
     * The case that matters in production. Every trainer already on the staff
     * screen has a saved list, and most of those lists were written while
     * `my_leads` was still a trainer default.
     */
    assert.equal(mayReceiveLeads(trainer(['dashboard', 'my_classes', 'my_leads'])), false,
      'a trainer configured by hand is still in the pool')
  })

  test('the role defaults no longer carry the leads portal either', () => {
    // Belt and braces: a new trainer gets no leads page at all, so there is
    // no screen implying work that will never arrive.
    assert.ok(!ROLE_DEFAULTS.trainer.includes(LEADS_PORTAL),
      'the trainer role still grants the leads portal by default')
  })

  test('a super admin is excluded the same way, and for the same reason', () => {
    assert.equal(mayReceiveLeads({ role: 'super_admin', portals: null }), false)
    assert.equal(mayReceiveLeads({ role: 'super_admin', portals: ['dashboard', 'my_leads'] }), false)
    assert.deepEqual([...NEVER_RECEIVES_LEADS].sort(), ['super_admin', 'trainer'])
  })
})

describe('and everybody who does work leads still gets them', () => {
  test('the roles whose job this is', () => {
    for (const role of ['marketing_officer', 'admissions_officer', 'project_manager', 'accountant']) {
      assert.equal(mayReceiveLeads({ role, portals: null }), true, `${role} can no longer receive a lead`)
    }
  })

  test('a person granted the portal by hand, whatever their role', () => {
    assert.equal(mayReceiveLeads({ role: 'receptionist', portals: ['dashboard', 'my_leads'] }), true)
  })

  test('the per-person opt-out still wins, and a null is not an opt-out', () => {
    /*
     * in_lead_pool is NULL for everybody never explicitly configured. Reading
     * that as false emptied the pool once already.
     */
    assert.equal(mayReceiveLeads({ role: 'marketing_officer', portals: null, inLeadPool: false }), false)
    assert.equal(mayReceiveLeads({ role: 'marketing_officer', portals: null, inLeadPool: null }), true)
    assert.equal(mayReceiveLeads({ role: 'marketing_officer', portals: null }), true)
  })

  test('a deactivated profile receives nothing', () => {
    assert.equal(mayReceiveLeads({ role: 'marketing_officer', portals: null, isActive: false }), false)
    assert.equal(mayReceiveLeads({ role: 'marketing_officer', portals: null, isActive: true }), true)
  })
})

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ' '))
}

describe('one rule, asked everywhere the question comes up', () => {
  const eligibility = codeOf('lib/leads/eligibility.ts')

  test('the pool is built from the shared rule, not from its own copy of it', () => {
    /*
     * Both halves. eligibleMarketers chooses who a lead goes to; isEligible
     * answers for one named person, and it is what refuses a lead handed over
     * by hand. A second copy of the rule in either place is how a trainer
     * comes back.
     */
    assert.match(eligibility, /mayReceiveLeads\(\{/)
    assert.equal((eligibility.match(/mayReceiveLeads\(\{/g) || []).length, 2,
      'one of the two eligibility answers no longer goes through the rule')
    assert.ok(!/role === 'super_admin'/.test(eligibility),
      'eligibility still has its own role exclusion, which will drift from the rule')
    assert.ok(!/includes\(LEADS_PORTAL\)/.test(eligibility),
      'eligibility still tests the portal itself instead of asking the rule')
  })

  test('the data layer reads the same constant rather than spelling it again', () => {
    const policy = codeOf('lib/data/policy.ts')
    assert.match(policy, /from '\.\.\/leads\/mayReceiveLeads\.ts'/)
    assert.ok(!/LEADS_PORTAL = 'my_leads'/.test(policy), 'policy has its own copy of the portal name')
  })

  test('the assignment screen offers only people who can be given a lead', () => {
    /*
     * The screen listed every active profile and the server refused the ones
     * who cannot hold a lead, so picking a trainer produced "that person
     * cannot receive leads" about a name the product had just offered.
     */
    const assign = codeOf('app/(portal)/pm/assign/page.tsx')
    assert.match(assign, /import \{ mayReceiveLeads \} from '@\/lib\/leads\/mayReceiveLeads'/)
    assert.match(assign, /\.filter\(m => mayReceiveLeads\(\{/)
    assert.match(assign, /select: 'id, full_name, email, phone, role, portals, in_lead_pool'/,
      'the screen does not read the columns the rule needs, so it cannot apply it')
  })

  test('the rule itself stays importable by the browser', () => {
    /*
     * The reason it is a separate module. One `server-only` import here and
     * the assignment screen cannot use it, and the two answers drift apart
     * again.
     */
    const rule = codeOf('lib/leads/mayReceiveLeads.ts')
    assert.ok(!/import 'server-only'/.test(rule), 'the shared rule is now server-only')
    assert.ok(!/supabase/i.test(rule), 'the shared rule reaches for the database')
  })
})

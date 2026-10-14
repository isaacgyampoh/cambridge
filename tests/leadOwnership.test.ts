import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideOwner, entersLeadsForTheCompany, mayNameAnotherOwner, COMPANY_LEAD_ROLES } from '../lib/leads/ownership.ts'
import { resolvePortals } from '../lib/access/portals.ts'

const ME = '11111111-1111-1111-1111-111111111111'
const COLLEAGUE = '22222222-2222-2222-2222-222222222222'
const portalsOf = (role: string) => resolvePortals(role, null)
const own = (role: string, extra: Record<string, unknown> = {}) =>
  decideOwner({ actorId: ME, role, portals: portalsOf(role), ...extra })

/**
 * A member of staff who goes out and finds somebody keeps that lead.
 *
 * Ownership used to be decided by whether the caller held the `leads` or
 * `pm_leads` PORTAL. An accountant holds `leads`. So does an admissions
 * officer, and so does anybody granted the access individually — which is how
 * an exams prep coordinator ended up reporting that the leads they entered
 * came out unassigned. A portal says what somebody may SEE; it should never
 * have decided what they OWN.
 */

describe('ordinary staff keep the leads they enter', () => {
  for (const role of ['accountant', 'admissions_officer', 'exam_coordinator',
                      'receptionist', 'marketing_officer', 'trainer', 'content_manager']) {
    test(`${role} keeps their own`, () => {
      const portals = role === 'receptionist'
        ? ['reminders', 'clock_in', 'my_leads']    // granted per person
        : portalsOf(role)
      assert.equal(decideOwner({ actorId: ME, role, portals }).owner, ME,
        `${role} lost their lead to the pool`)
    })
  }

  test('an accountant specifically — one of the five roles that was losing them', () => {
    const d = own('accountant')
    assert.equal(d.owner, ME)
    assert.match(d.because, /person who will work it/i)
  })

  test('holding the leads portal no longer takes the lead away', () => {
    // The exact regression: the portal grant decided ownership.
    assert.ok(portalsOf('accountant').includes('leads'), 'precondition: accountant holds it')
    assert.equal(own('accountant').owner, ME)
  })

  test('a coordinator granted the leads portal individually still keeps theirs', () => {
    // How the exams prep complaint arose: extra access changed who owned their work.
    const d = decideOwner({ actorId: ME, role: 'exam_coordinator', portals: ['my_leads', 'leads'] })
    assert.equal(d.owner, ME)
  })
})

describe('the super admin and the PM enter leads for the centre', () => {
  for (const role of ['super_admin', 'administrator', 'project_manager']) {
    test(`${role} creates a company lead by default`, () => {
      assert.equal(own(role).owner, null, `${role} took the lead personally`)
    })

    test(`${role} can keep one deliberately`, () => {
      assert.equal(own(role, { keepForSelf: true }).owner, ME)
    })
  }

  test('the roles are stated, not inferred from a portal', () => {
    assert.deepEqual([...COMPANY_LEAD_ROLES].sort(),
      ['administrator', 'project_manager', 'super_admin'])
    assert.equal(entersLeadsForTheCompany('super_admin'), true)
    assert.equal(entersLeadsForTheCompany('accountant'), false)
    assert.equal(entersLeadsForTheCompany(null), false)
    assert.equal(entersLeadsForTheCompany(undefined), false)
  })
})

describe('naming somebody else', () => {
  test('a distributor may', () => {
    assert.equal(own('project_manager', { requestedOwner: COLLEAGUE }).owner, COLLEAGUE)
    assert.equal(own('accountant', { requestedOwner: COLLEAGUE }).owner, COLLEAGUE)
  })

  test('a marketer may not, whatever the browser sends', () => {
    /*
     * A marketer naming a colleague as the owner of a lead is a commission
     * dispute waiting to happen, and the browser can send any id at all.
     */
    assert.equal(own('marketing_officer', { requestedOwner: COLLEAGUE }).owner, ME)
    assert.equal(own('trainer', { requestedOwner: COLLEAGUE }).owner, ME)
    assert.equal(own('receptionist', { requestedOwner: COLLEAGUE }).owner, ME)
  })

  test('who may delegate is reported, so a screen can offer it honestly', () => {
    assert.equal(mayNameAnotherOwner('accountant', portalsOf('accountant')), true)
    assert.equal(mayNameAnotherOwner('marketing_officer', portalsOf('marketing_officer')), false)
    assert.equal(mayNameAnotherOwner('super_admin', []), true, 'by role, with no portal at all')
  })

  test('a distributor may send one to the pool deliberately', () => {
    assert.equal(own('accountant', { toPool: true }).owner, null)
  })

  test('an ordinary member of staff cannot push their lead into the pool', () => {
    // Otherwise "it is yours" is only true until somebody sends a flag.
    assert.equal(own('marketing_officer', { toPool: true }).owner, ME)
  })

  test('a named owner beats both flags, because it is the most explicit', () => {
    assert.equal(own('super_admin', { requestedOwner: COLLEAGUE, toPool: true }).owner, COLLEAGUE)
  })
})

describe('everyone who should be able to enter a lead, can', () => {
  test('the front desk is granted lead access per person, not by role', () => {
    /*
     * `my_leads` does two jobs: it grants the leads screens, and it makes
     * somebody a DESTINATION for distributed leads. Putting it on the
     * receptionist ROLE would start routing the pool to every front-desk
     * account — which RC-1 in tests/leadAssignment exists to prevent, and a
     * lead handed to somebody who does not work leads is a lead nobody works.
     *
     * So it stays a per-person grant from the staff screen. What this pins is
     * that when it IS granted, the lead is theirs.
     */
    assert.equal(portalsOf('receptionist').includes('my_leads'), false, 'not by role')
    const granted = decideOwner({
      actorId: ME, role: 'receptionist', portals: ['reminders', 'clock_in', 'my_leads'],
    })
    assert.equal(granted.owner, ME, 'a granted receptionist must keep their own lead')
  })

  for (const role of ['accountant', 'exam_coordinator', 'marketing_officer', 'project_manager']) {
    test(`${role} holds a portal the create route accepts`, () => {
      const p = portalsOf(role)
      assert.ok(p.some(x => ['my_leads', 'leads', 'pm_leads'].includes(x)),
        `${role} cannot reach /api/leads/create at all`)
    })
  }
})

describe('the route decides it, not the browser', () => {
  const s = readFileSync('app/api/leads/create/route.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  test('ownership comes from the shared policy', () => {
    assert.match(s, /decideOwner\(\{/)
    assert.match(s, /role: session\.role/)
    assert.match(s, /actorId: session\.userId/)
  })

  test('the old portal-based rule is gone', () => {
    assert.doesNotMatch(s, /const distributes =/,
      'ownership must not be inferred from a portal grant')
  })

  test('who entered it is recorded even when it goes to the centre', () => {
    // There is no created_by column on leads; without this a company lead
    // carried no trace of who typed it until the lottery placed it.
    assert.match(s, /assigned_by: session\.userId,/)
    assert.doesNotMatch(s, /assigned_by: owner \? session\.userId : null/)
  })

  test('the audit says whether it went to the company', () => {
    assert.match(s, /forTheCompany: owner === null/)
  })
})

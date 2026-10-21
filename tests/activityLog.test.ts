import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canReachApi } from '../lib/access/apiAccess.ts'
import { resolvePortals, PORTAL_PATHS } from '../lib/access/portals.ts'

const code = (p: string) => readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const portalsOf = (r: string) => resolvePortals(r, null)

/**
 * recordAudit() has written to audit_logs since September — eight hundred
 * entries, thirty-two kinds of action — and nothing read them. No screen, no
 * route, and no role may reach the table through /api/data either. A trail
 * nobody can see is worse than no trail: everybody believes there is a record.
 */

describe('who can see the activity log', () => {
  for (const role of ['super_admin', 'administrator', 'project_manager']) {
    test(`${role} can`, () => {
      assert.equal(canReachApi('/api/activity-log', role, portalsOf(role)), true)
    })
  }

  for (const role of ['accountant', 'trainer', 'marketing_officer', 'receptionist',
                      'exam_coordinator', 'admissions_officer', 'student']) {
    test(`${role} cannot`, () => {
      assert.equal(canReachApi('/api/activity-log', role, portalsOf(role)), false,
        `${role} can read every action taken across the organisation`)
    })
  }

  test('it is behind a portal named for the job', () => {
    /*
     * It was first put behind `reports`, which a marketing officer also
     * holds — so a marketer could have read every fee re-pricing and every
     * account provisioned. `academics` happens to draw the right line today,
     * and would be a portal about programmes granting an audit log, which is
     * the kind of coincidence that stops being true quietly.
     */
    assert.ok(PORTAL_PATHS.oversight, 'there must be an oversight portal')
    assert.deepEqual(PORTAL_PATHS.oversight, ['/admin/activity'])
    assert.equal(portalsOf('marketing_officer').includes('oversight'), false)
  })

  test('it is not under /api/admin, which would lock out the PM', () => {
    // That prefix is SUPER_ADMIN_ONLY and is checked before portals.
    const api = readFileSync('lib/access/apiAccess.ts', 'utf8')
    assert.match(api, /'\/api\/activity-log':\s*\['oversight'\]/)
    assert.doesNotMatch(api, /'\/api\/admin\/activity'/)
  })
})

describe('the route', () => {
  const s = code('app/api/activity-log/route.ts')

  test('it reads the audit trail', () => {
    assert.match(s, /from\('audit_logs'\)/)
  })

  test('it checks the role itself, not only the portal — in EVERY handler', () => {
    /*
     * There are two exported handlers. A file-wide match passed with the
     * check removed from GET, because POST still had one — so each is
     * checked separately.
     */
    assert.match(s, /const MAY_VIEW = \['super_admin', 'administrator', 'project_manager'\]/)
    const handlers = ['export async function GET', 'export async function POST']
    for (const h of handlers) {
      const at = s.indexOf(h)
      assert.notEqual(at, -1, `${h} not found`)
      const next = handlers.map(x => s.indexOf(x, at + 10)).filter(i => i > -1)
      const body = s.slice(at, next.length ? Math.min(...next) : s.length)
      assert.match(body, /MAY_VIEW\.includes\(session\.role \|\| ''\)/,
        `${h} does not check the role`)
    }
  })

  test('ids are resolved to names, in one query not per row', () => {
    // A log reading "7e6a8f66-… reprice" is a log nobody uses.
    assert.match(s, /from\('profiles'\)[\s\S]{0,80}?\.in\('id', ids\)/)
    assert.match(s, /actor:/)
  })

  test('metadata is not returned in the list', () => {
    /*
     * It carries whatever each caller chose to record — reasons, amounts,
     * student names. The list answers "who did what, when"; the rest belongs
     * behind its own decision.
     */
    assert.doesNotMatch(s, /select\('[^']*metadata/)
  })

  test('the page size is bounded', () => {
    assert.match(s, /MAX_PAGE/)
    assert.match(s, /Math\.min\(MAX_PAGE/)
  })

  test('the date range includes the whole of the end day', () => {
    // A range ending "today" that stops at midnight shows nothing from today.
    assert.match(s, /\$\{to\}T23:59:59\.999Z/)
  })
})

describe('the screen', () => {
  const page = readFileSync('app/(portal)/admin/activity/page.tsx', 'utf8')

  test('it reads the route', () => {
    assert.match(page, /\/api\/activity-log/)
  })

  test('machine action names are turned into words', () => {
    assert.match(page, /function phrase/)
    assert.match(page, /replace\(\/_\/g, ' '\)/)
  })

  test('it distinguishes an empty log from a filtered-out one', () => {
    // "Nothing recorded" when a filter hid everything sends somebody looking
    // for a fault that is not there.
    assert.match(page, /No activity matches those filters/)
    assert.match(page, /No activity has been recorded yet/)
  })

  test('a failed read is shown as a failure, not as emptiness', () => {
    assert.match(page, /state === 'error'/)
    assert.match(page, /setProblem/)
  })
})

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { canReachPage, allowedExactPaths } from '../lib/access/pageAccess.ts'
import { resolvePortals, ROLE_DEFAULTS, ROLE_HOME, PORTAL_EXACT_PATHS } from '../lib/access/portals.ts'

/**
 * Page access.
 *
 * ── THE ESCALATION THESE PIN SHUT ──────────────────────────────────────────
 *
 * The `dashboard` portal — which every role holds — listed the nine role
 * landing pages in PORTAL_PATHS: '/admin', '/pm', '/marketer', '/finance' and
 * so on. Page access matches by prefix:
 *
 *     pathname === p || pathname.startsWith(p + '/')
 *
 * so '/admin' did not grant the admin home page. It granted everything
 * beneath it. A student, holding only `dashboard` and `my_payments`, could
 * open /admin/settings, /admin/staff, /admin/finance and /admin/remuneration.
 * So could a trainer, and so could a marketing officer.
 *
 * The tables on those screens were empty, because /api access is scoped
 * separately and correctly. But the screens rendered, and any page reading its
 * own data server-side would have leaked outright.
 *
 * Landing pages are now matched exactly, via PORTAL_EXACT_PATHS.
 */

const ROLES = Object.keys(ROLE_DEFAULTS)
const portalsFor = (role: string) => resolvePortals(role, null)

/** Pages that must never open for someone who was not given them explicitly. */
const RESTRICTED = [
  '/admin/settings', '/admin/staff', '/admin/finance', '/admin/remuneration',
  '/admin/marketers', '/admin/workforce', '/admin/whatsapp', '/admin/knowledge',
  '/admin/webhook-log', '/admin/sms-delivery', '/admin/reports',
]

describe('a landing page grants itself, not its subtree', () => {
  test('a student cannot reach a single administrative screen', () => {
    const portals = portalsFor('student')
    for (const path of RESTRICTED) {
      assert.equal(canReachPage(path, 'student', portals), false,
        `a student can open ${path}`)
    }
  })

  test('a trainer and a marketing officer cannot either', () => {
    for (const role of ['trainer', 'marketing_officer']) {
      const portals = portalsFor(role)
      for (const path of RESTRICTED) {
        assert.equal(canReachPage(path, role, portals), false,
          `a ${role} can open ${path}`)
      }
    }
  })

  test('the landing page itself still opens', () => {
    // The fix must not lock people out of their own home.
    for (const role of ROLES) {
      const home = ROLE_HOME[role]
      if (!home) continue
      assert.equal(canReachPage(home, role, portalsFor(role)), true,
        `${role} cannot open their own home page ${home}`)
    }
  })

  test('every exact path is a single segment, so none can be a subtree by accident', () => {
    for (const paths of Object.values(PORTAL_EXACT_PATHS)) {
      for (const p of paths) {
        assert.match(p, /^\/[a-z-]+$/, `${p} is not a plain landing page`)
      }
    }
  })

  test('holding dashboard alone grants no page beyond the landing pages', () => {
    const only = ['dashboard']
    const granted = allowedExactPaths(only)
    for (const path of granted) {
      assert.equal(canReachPage(path, 'student', only), true)
      // …but nothing under it.
      assert.equal(canReachPage(path + '/anything', 'student', only), false,
        `${path} still grants its subtree`)
    }
  })
})

describe('explicit access still works', () => {
  test('someone given the staff portal can open staff pages', () => {
    assert.equal(canReachPage('/admin/staff', 'administrator', ['staff']), true)
    assert.equal(canReachPage('/admin/staff/abc', 'administrator', ['staff']), true)
  })

  test('a super admin is unaffected', () => {
    for (const path of RESTRICTED) {
      assert.equal(canReachPage(path, 'super_admin', []), true)
    }
  })

  test('prefix matching does not leak across similar names', () => {
    assert.equal(canReachPage('/admin/staffing', 'administrator', ['staff']), false)
  })
})

describe('SMS delivery is scoped to whoever runs messaging', () => {
  test('an ordinary inbox does not include the delivery log', () => {
    // Every message body in the organisation is on that screen. `messages` is
    // held by nearly every role; it is not the right key for it.
    for (const role of ['marketing_officer', 'trainer', 'admissions_officer']) {
      assert.equal(canReachPage('/admin/sms-delivery', role, portalsFor(role)), false,
        `${role} can read the whole organisation's SMS log`)
    }
  })

  test('broadcast and settings still reach it', () => {
    assert.equal(canReachPage('/admin/sms-delivery', 'administrator', ['broadcast']), true)
    assert.equal(canReachPage('/admin/sms-delivery', 'administrator', ['settings']), true)
  })
})

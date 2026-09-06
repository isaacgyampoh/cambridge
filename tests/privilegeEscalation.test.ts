import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { canReachPage } from '../lib/access/pageAccess.ts'
import { canReachApi, API_PORTALS, SUPER_ADMIN_ONLY } from '../lib/access/apiAccess.ts'
import { resolvePortals, ROLE_DEFAULTS } from '../lib/access/portals.ts'

/**
 * PRIVILEGE ESCALATION — PERMANENT REGRESSION SUITE.
 *
 * ── THE VULNERABILITY THESE EXIST TO PREVENT ───────────────────────────────
 *
 * PORTAL_PATHS mapped the `dashboard` portal — which every role holds — to the
 * nine role landing pages: '/admin', '/pm', '/marketer', '/finance' and so on.
 * Page access matches by prefix:
 *
 *     pathname === p || pathname.startsWith(p + '/')
 *
 * So listing '/admin' did not grant the admin home page. It granted every page
 * beneath it. A student — whose only portals are `dashboard` and
 * `my_payments` — could open /admin/settings, /admin/staff, /admin/finance,
 * /admin/remuneration and every other administrative screen. So could a
 * trainer, and so could a marketing officer.
 *
 * The predicate above is quoted verbatim from proxy.ts as it stood, so this
 * was live in production.
 *
 * These tests assert the authorization CONTRACT — the same functions proxy.ts
 * calls on every request. They are not a substitute for an authenticated
 * browser walkthrough, which is recorded separately as NOT VERIFIED.
 *
 * THIS SUITE MUST REMAIN GREEN.
 */

const portalsFor = (role: string) => resolvePortals(role, null)

/** Every administrative page the application actually ships. */
const ADMIN_PAGES = [
  '/admin/academics', '/admin/admissions', '/admin/alumni', '/admin/attendance',
  '/admin/automation', '/admin/broadcast', '/admin/certificates', '/admin/classes',
  '/admin/conversations', '/admin/conversions', '/admin/courses', '/admin/documents',
  '/admin/finance', '/admin/insights', '/admin/knowledge', '/admin/leads',
  '/admin/leads/import', '/admin/links', '/admin/marketers', '/admin/referrals',
  '/admin/registrations', '/admin/remuneration', '/admin/reports', '/admin/sequences',
  '/admin/settings', '/admin/sms-delivery', '/admin/staff', '/admin/transfers',
  '/admin/webhook-log', '/admin/whatsapp', '/admin/workforce',
]

/**
 * Roles that must not reach administrative screens by default, and the pages
 * each is legitimately entitled to despite the blanket rule.
 *
 * Listing the exceptions explicitly is the point: a future change that grants
 * one of these roles a new admin page has to come here and say so.
 */
const RESTRICTED: Record<string, string[]> = {
  student: [],
  receptionist: [],
  /*
   * These four hold `my_leads`, which grants /admin/conversions.
   *
   * The URL sits under /admin, but the screen is a marketer's own conversion
   * figures — /api/analytics/courses filters to assigned_to = the caller for
   * every role except super_admin and project_manager. Verified by reading
   * that route, not assumed from the path.
   *
   * The exception is listed rather than the assertion loosened, so granting
   * one of these roles a genuinely administrative page has to be declared
   * here first.
   */
  marketing_officer: ['/admin/conversions'],
  content_manager: ['/admin/conversions'],

  /*
   * A trainer additionally holds `attendance` and `documents` — they mark
   * class registers and hand out course material. Both screens live under
   * /admin by URL only.
   */
  trainer: ['/admin/attendance', '/admin/conversions', '/admin/documents'],

  /* An exam coordinator holds `documents` for prep material. */
  exam_coordinator: ['/admin/conversions', '/admin/documents'],
}

describe('a restricted role cannot open an administrative page by typing its URL', () => {
  for (const [role, allowed] of Object.entries(RESTRICTED)) {
    test(`${role}`, () => {
      const portals = portalsFor(role)
      const reachable = ADMIN_PAGES.filter(p => canReachPage(p, role, portals))
      assert.deepEqual(reachable, allowed,
        `${role} can open: ${reachable.join(', ')}`)
    })
  }
})

describe('a landing page grants itself and nothing beneath it', () => {
  test('holding dashboard does not grant any subtree', () => {
    // The escalation in one line: '/admin' must not imply '/admin/anything'.
    for (const landing of ['/admin', '/pm', '/marketer', '/finance', '/trainer', '/student']) {
      assert.equal(canReachPage(landing, 'student', ['dashboard']), true,
        `${landing} should be reachable as a landing page`)
      assert.equal(canReachPage(`${landing}/settings`, 'student', ['dashboard']), false,
        `${landing} still grants its subtree`)
      assert.equal(canReachPage(`${landing}/staff`, 'student', ['dashboard']), false)
    }
  })
})

describe('a restricted role is refused administrative APIs', () => {
  /** Prefixes that carry organisation-wide or privileged data. */
  const PRIVILEGED_APIS = [
    '/api/admin', '/api/admin/purge-leads', '/api/test',
    '/api/staff', '/api/staff/workload', '/api/workforce', '/api/remuneration',
    '/api/marketers', '/api/finance', '/api/fees/verify', '/api/sms/delivery',
    '/api/knowledge', '/api/whatsapp', '/api/leads/imports',
  ]

  for (const role of Object.keys(RESTRICTED)) {
    test(`${role} is refused every privileged API prefix`, () => {
      const portals = portalsFor(role)
      const reachable = PRIVILEGED_APIS.filter(p => canReachApi(p, role, portals))
      assert.deepEqual(reachable, [], `${role} can call: ${reachable.join(', ')}`)
    })
  }

  test('super-admin-only prefixes are refused to every other role', () => {
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      if (role === 'super_admin') continue
      for (const prefix of SUPER_ADMIN_ONLY) {
        assert.equal(canReachApi(prefix, role, portalsFor(role)), false,
          `${role} can reach ${prefix}`)
        assert.equal(canReachApi(`${prefix}/anything`, role, portalsFor(role)), false,
          `${role} can reach ${prefix}/anything`)
      }
    }
  })

  test('an unmapped API path is refused rather than allowed', () => {
    // Default-deny: a new endpoint must be classified deliberately.
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      if (role === 'super_admin') continue
      assert.equal(canReachApi('/api/brand-new-endpoint', role, portalsFor(role)), false)
    }
  })
})

describe('an administrator retains the access they need', () => {
  const ADMIN_ROLES = ['super_admin', 'administrator']

  test('a super admin can open every administrative page', () => {
    for (const page of ADMIN_PAGES) {
      assert.equal(canReachPage(page, 'super_admin', portalsFor('super_admin')), true,
        `a super admin is refused ${page}`)
    }
  })

  test('an administrator can open the pages their portals grant', () => {
    const portals = portalsFor('administrator')
    const reachable = ADMIN_PAGES.filter(p => canReachPage(p, 'administrator', portals))
    // Not every page — an administrator is deliberately not a super admin —
    // but the core operational screens must be reachable or the role is inert.
    for (const required of ['/admin/leads', '/admin/admissions', '/admin/registrations']) {
      assert.ok(reachable.includes(required), `an administrator is refused ${required}`)
    }
  })

  test('admin roles are not accidentally locked out of their own APIs', () => {
    for (const role of ADMIN_ROLES) {
      assert.equal(canReachApi('/api/leads', role, portalsFor(role)), true)
      assert.equal(canReachApi('/api/admissions', role, portalsFor(role)), true)
    }
  })
})

describe('the access map itself stays sane', () => {
  test('no API prefix is granted to an empty portal list', () => {
    for (const [path, portals] of Object.entries(API_PORTALS)) {
      assert.ok(portals.length > 0, `${path} is mapped to no portal, so nobody can reach it`)
    }
  })

  test('prefix matching cannot leak across similar names', () => {
    const p = portalsFor('marketing_officer')
    assert.equal(canReachApi('/api/leadsomething', 'marketing_officer', p), false)
    assert.equal(canReachPage('/admin/staffing', 'marketing_officer', p), false)
  })
})

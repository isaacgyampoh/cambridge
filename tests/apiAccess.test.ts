import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { canReachApi } from '../lib/access/apiAccess.ts'
import { resolvePortals, ROLE_DEFAULTS } from '../lib/access/portals.ts'

/**
 * The route guard previously granted a fixed list of about forty-five /api
 * prefixes to EVERY signed-in user before their portals were consulted. These
 * tests pin down that API access now follows from the user's portals.
 */

const portalsFor = (role: string) => resolvePortals(role, null)

describe('privilege separation between roles', () => {
  test('a student cannot reach staff or money endpoints', () => {
    const p = portalsFor('student')
    for (const path of [
      '/api/admin/create-staff',
      '/api/remuneration',
      '/api/finance/payment-reminder',
      '/api/registrations',
      '/api/tiers/recalc',
      '/api/pm/dashboard',
      '/api/leads/assign',
      '/api/broadcast',
    ]) {
      assert.equal(canReachApi(path, 'student', p), false, `student reached ${path}`)
    }
  })

  test('a trainer cannot reach finance or admin', () => {
    const p = portalsFor('trainer')
    assert.equal(canReachApi('/api/finance/payment-reminder', 'trainer', p), false)
    assert.equal(canReachApi('/api/admin/clear-leads', 'trainer', p), false)
    assert.equal(canReachApi('/api/remuneration', 'trainer', p), false)
  })

  test('a marketer cannot reach admin, finance or remuneration', () => {
    const p = portalsFor('marketing_officer')
    assert.equal(canReachApi('/api/admin/delete-staff', 'marketing_officer', p), false)
    assert.equal(canReachApi('/api/registrations', 'marketing_officer', p), false)
    assert.equal(canReachApi('/api/remuneration', 'marketing_officer', p), false)
  })

  test('no role except super admin reaches /api/admin', () => {
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      if (role === 'super_admin') continue
      assert.equal(
        canReachApi('/api/admin/create-staff', role, portalsFor(role)),
        false,
        `${role} must not reach /api/admin`
      )
    }
  })

  test('super admin reaches everything', () => {
    for (const path of ['/api/admin/create-staff', '/api/finance', '/api/remuneration', '/api/anything-new']) {
      assert.equal(canReachApi(path, 'super_admin', []), true)
    }
  })
})

describe('roles keep the access they need', () => {
  test('an accountant reaches finance and registrations', () => {
    const p = portalsFor('accountant')
    assert.equal(canReachApi('/api/finance/payment-reminder', 'accountant', p), true)
    assert.equal(canReachApi('/api/registrations', 'accountant', p), true)
    assert.equal(canReachApi('/api/fees/pay', 'accountant', p), true)
  })

  test('a marketer reaches their own leads, link and flyers', () => {
    const p = portalsFor('marketing_officer')
    assert.equal(canReachApi('/api/leads/status', 'marketing_officer', p), true)
    assert.equal(canReachApi('/api/marketer/dashboard', 'marketing_officer', p), true)
    assert.equal(canReachApi('/api/flyers', 'marketing_officer', p), true)
    assert.equal(canReachApi('/api/reports', 'marketing_officer', p), true)
  })

  test('a trainer reaches classes and attendance', () => {
    const p = portalsFor('trainer')
    assert.equal(canReachApi('/api/trainer/dashboard', 'trainer', p), true)
    assert.equal(canReachApi('/api/classes/attendance', 'trainer', p), true)
    assert.equal(canReachApi('/api/attendance', 'trainer', p), true)
  })

  test('a project manager reaches PM and lead endpoints', () => {
    const p = portalsFor('project_manager')
    assert.equal(canReachApi('/api/pm/dashboard', 'project_manager', p), true)
    assert.equal(canReachApi('/api/leads/assign', 'project_manager', p), true)
  })

  test('everyone signed in can sign out and read their own session', () => {
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      const p = portalsFor(role)
      assert.equal(canReachApi('/api/auth/logout', role, p), true, `${role} cannot log out`)
      assert.equal(canReachApi('/api/data', role, p), true, `${role} cannot reach /api/data`)
    }
  })
})

describe('unknown endpoints are refused, not allowed', () => {
  test('a path with no mapping is denied for a normal role', () => {
    assert.equal(canReachApi('/api/something-brand-new', 'trainer', portalsFor('trainer')), false)
  })

  test('prefix matching does not leak across similar names', () => {
    // /api/leads must not grant /api/leadsomething
    const p = portalsFor('marketing_officer')
    assert.equal(canReachApi('/api/leadsomething', 'marketing_officer', p), false)
  })

  test('the longest matching prefix decides', () => {
    // /api/class-reminders must be judged on its own entry, not /api/classes
    const p = portalsFor('accountant')
    assert.equal(canReachApi('/api/class-reminders/run', 'accountant', p), true)
  })
})

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  canRead, canWrite, canDelete, ownerColumnFor, isValidIdentifier,
  embeddedRelations, scrubRow, UNWRITABLE_COLUMNS, SECRET_COLUMNS,
} from '../lib/data/policy.ts'

/**
 * Regression tests for the /api/data access policy.
 *
 * Each block names the specific hole it exists to keep closed. These are the
 * checks that stand between a signed-in student and the whole database, so
 * they are worth having in a form that fails loudly.
 */

describe('table allowlists', () => {
  test('a student cannot write to any table', () => {
    for (const t of ['profiles', 'payments', 'leads', 'invoices', 'courses']) {
      assert.equal(canWrite(t, 'student'), false, `student must not write ${t}`)
      assert.equal(canDelete(t, 'student'), false, `student must not delete ${t}`)
    }
  })

  test('no role but super admin may write to profiles', () => {
    // Roles and portals are changed through audited /api/admin routes only.
    for (const role of [
      'administrator', 'project_manager', 'marketing_officer', 'accountant',
      'admissions_officer', 'receptionist', 'trainer', 'exam_coordinator',
      'content_manager', 'student',
    ]) {
      assert.equal(canWrite('profiles', role), false, `${role} must not write profiles`)
    }
    assert.equal(canWrite('profiles', 'super_admin'), true)
  })

  test('an unknown role gets nothing', () => {
    assert.equal(canRead('leads', 'nonsense'), false)
    assert.equal(canWrite('leads', 'nonsense'), false)
    assert.equal(canDelete('leads', 'nonsense'), false)
  })

  test('a marketer reads leads but cannot read payments', () => {
    assert.equal(canRead('leads', 'marketing_officer'), true)
    assert.equal(canRead('payments', 'marketing_officer'), false)
  })
})

describe('row scoping', () => {
  test('students are scoped to their own payments and invoices', () => {
    // Students were previously allowed these tables with no owner filter at
    // all, so any student could read every payment in the school.
    assert.equal(ownerColumnFor('payments', 'student'), 'student_id')
    assert.equal(ownerColumnFor('invoices', 'student'), 'student_id')
  })

  test('marketers see only leads assigned to them', () => {
    assert.equal(ownerColumnFor('leads', 'marketing_officer'), 'assigned_to')
    assert.equal(ownerColumnFor('leads', 'trainer'), 'assigned_to')
  })

  test('non-oversight roles are locked to their own profile row', () => {
    assert.equal(ownerColumnFor('profiles', 'trainer'), 'id')
    assert.equal(ownerColumnFor('profiles', 'student'), 'id')
    assert.equal(ownerColumnFor('profiles', 'project_manager'), null)
  })

  test('super admin is never row-scoped', () => {
    assert.equal(ownerColumnFor('leads', 'super_admin'), null)
    assert.equal(ownerColumnFor('payments', 'super_admin'), null)
  })
})

describe('select embedding', () => {
  test('finds a bare embedded relation', () => {
    // ?table=batch_students&select=*,profiles(*) reached profiles without
    // profiles ever being checked against the allowlist.
    assert.deepEqual(embeddedRelations('*,profiles(*)'), ['profiles'])
  })

  test('finds an aliased embed', () => {
    const found = embeddedRelations('*,student:student_id(full_name)')
    assert.ok(found.includes('student_id'), 'must see through the alias')
  })

  test('finds several, including nested', () => {
    const found = embeddedRelations('*,leads(*),course:course_id(name,batches(id))')
    for (const rel of ['leads', 'course_id', 'batches']) {
      assert.ok(found.includes(rel), `expected to find ${rel}`)
    }
  })

  test('a plain select embeds nothing', () => {
    assert.deepEqual(embeddedRelations('*'), [])
    assert.deepEqual(embeddedRelations('id,full_name,created_at'), [])
  })
})

describe('identifier validation', () => {
  test('accepts ordinary table names', () => {
    assert.equal(isValidIdentifier('lead_activities'), true)
    assert.equal(isValidIdentifier('profiles'), true)
  })

  test('rejects anything that could carry SQL or a traversal', () => {
    for (const bad of [
      'profiles; drop table profiles',
      'profiles--',
      'public.profiles',
      'profiles(*)',
      '',
      ' profiles',
      '1table',
      'Profiles',      // uppercase is not a real table here
    ]) {
      assert.equal(isValidIdentifier(bad), false, `must reject ${JSON.stringify(bad)}`)
    }
  })
})

describe('column scrubbing', () => {
  test('strips credentials from a top-level row', () => {
    const out = scrubRow({ id: '1', full_name: 'A', pin_hash: 'x' }, SECRET_COLUMNS) as Record<string, unknown>
    assert.equal(out.pin_hash, undefined)
    assert.equal(out.full_name, 'A')
  })

  test('strips credentials from a NESTED embed', () => {
    // The original scrubber only walked the top level, and only ran for roles
    // that could not see money — so an accountant reading profiles received
    // every colleague's pin_hash.
    const row = { id: '1', student: { id: '2', full_name: 'B', pin_hash: 'secret' } }
    const out = scrubRow(row, SECRET_COLUMNS) as Record<string, Record<string, unknown>>
    assert.equal(out.student.pin_hash, undefined)
    assert.equal(out.student.full_name, 'B')
  })

  test('strips through arrays of embedded rows', () => {
    const rows = [{ payments: [{ id: '1', pin_hash: 'z' }] }]
    const out = scrubRow(rows, SECRET_COLUMNS) as Array<{ payments: Array<Record<string, unknown>> }>
    assert.equal(out[0].payments[0].pin_hash, undefined)
  })

  test('reports whether a WhatsApp key is set without revealing it', () => {
    const out = scrubRow({ id: '1', wasender_api_key: 'live-key' }, SECRET_COLUMNS) as Record<string, unknown>
    assert.equal(out.wasender_api_key, undefined)
    assert.equal(out.has_wasender_key, true)
  })
})

describe('unwritable columns', () => {
  test('the fields that grant access cannot be set through the generic endpoint', () => {
    // A PATCH of {role:'super_admin'} on profiles was the escalation path.
    for (const col of ['role', 'portals', 'is_active', 'pin_hash', 'marketer_code']) {
      assert.ok(UNWRITABLE_COLUMNS.includes(col), `${col} must be unwritable`)
    }
  })
})

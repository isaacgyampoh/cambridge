import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  validateRegistration, feeFor, phoneVariants, MANUAL_SOURCE,
} from '../lib/academics/manualRegistration.ts'
import { canReachApi } from '../lib/access/apiAccess.ts'
import { resolvePortals } from '../lib/access/portals.ts'

function code(path: string) {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const ROUTE = 'app/api/academics/manual-registration/route.ts'
const COURSE_ID = '11111111-2222-3333-4444-555555555555'
const BATCH_ID = '66666666-7777-8888-9999-000000000000'

const good = {
  fullName: 'Kwame Boateng', phone: '0241234567', courseId: COURSE_ID, delivery: 'in_person',
}

describe('what the form must contain', () => {
  test('a complete registration is accepted and normalised', () => {
    const r = validateRegistration({ ...good, email: ' KWAME@Example.COM ', gender: 'Male' })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.value.phone, '233241234567', 'the phone is stored in one canonical shape')
    assert.equal(r.value.email, 'kwame@example.com')
    assert.equal(r.value.gender, 'male')
    assert.equal(r.value.registrationDate.length, 10, 'it defaults to today')
  })

  test('name, phone, programme and attendance are required', () => {
    const r = validateRegistration({})
    assert.equal(r.ok, false)
    if (r.ok) return
    for (const f of ['fullName', 'phone', 'courseId', 'delivery']) {
      assert.ok(r.errors[f], `${f} was not required`)
    }
  })

  test('every problem is reported at once, not one at a time', () => {
    // The modal keeps what was typed; errors arriving one per submit would
    // make somebody correct four fields in four round trips.
    const r = validateRegistration({ fullName: '', phone: 'xx', courseId: 'nope', delivery: 'maybe' })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.ok(Object.keys(r.errors).length >= 4, `only ${Object.keys(r.errors).length} reported`)
  })

  test('a student with no email is allowed; a malformed one is not', () => {
    const none = validateRegistration(good)
    assert.equal(none.ok, true)
    if (none.ok) assert.equal(none.value.email, null, 'absent, not invented')

    const bad = validateRegistration({ ...good, email: 'not-an-address' })
    assert.equal(bad.ok, false)
    if (!bad.ok) assert.ok(bad.errors.email)
  })

  test('the phone must be a real Ghana mobile', () => {
    for (const phone of ['123', '0241234', 'abcdefghij', '']) {
      const r = validateRegistration({ ...good, phone })
      assert.equal(r.ok, false, `${JSON.stringify(phone)} was accepted`)
    }
    for (const phone of ['0241234567', '233241234567', '+233 24 123 4567', '00233241234567']) {
      const r = validateRegistration({ ...good, phone })
      assert.equal(r.ok, true, `${phone} was rejected`)
      if (r.ok) assert.equal(r.value.phone, '233241234567')
    }
  })

  test('attendance has no default, because it decides the fee', () => {
    // complete.ts carries the same note: a null delivery once silently
    // charged the in-person fee.
    const r = validateRegistration({ ...good, delivery: '' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.errors.delivery, /in person or online/i)
  })

  test('a programme must be a real reference, not free text', () => {
    const r = validateRegistration({ ...good, courseId: 'PMP' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.errors.courseId)
  })

  test('dates must be real, and not in the future', () => {
    const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    assert.equal(validateRegistration({ ...good, dateOfBirth: tomorrow }).ok, false)
    assert.equal(validateRegistration({ ...good, registrationDate: tomorrow }).ok, false)
    assert.equal(validateRegistration({ ...good, dateOfBirth: '1990-04-02' }).ok, true)
    assert.equal(validateRegistration({ ...good, registrationDate: '2026-01-05' }).ok, true)
  })

  test('an optional field left empty is null, never an empty string', () => {
    const r = validateRegistration(good)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.value.email, null)
    assert.equal(r.value.gender, null)
    assert.equal(r.value.dateOfBirth, null)
    assert.equal(r.value.batchId, null)
    assert.equal(r.value.notes, null)
  })

  test('a chosen class is carried through', () => {
    const r = validateRegistration({ ...good, batchId: BATCH_ID })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.value.batchId, BATCH_ID)
  })
})

describe('the fee follows the institution’s existing rule', () => {
  const course = { course_fee: 5950, course_fee_online: 4950 }

  test('in person pays the in-person fee, online pays the online one', () => {
    assert.equal(feeFor(course, 'in_person'), 5950)
    assert.equal(feeFor(course, 'online'), 4950)
  })

  test('with no online fee set, an online student pays the in-person fee', () => {
    // Identical to createFeeLedger in lib/registration/complete.ts.
    assert.equal(feeFor({ course_fee: 5950, course_fee_online: 0 }, 'online'), 5950)
    assert.equal(feeFor({ course_fee: 5950 }, 'online'), 5950)
  })

  test('a programme with no fee recorded is zero, not a guess', () => {
    assert.equal(feeFor({}, 'in_person'), 0)
    assert.equal(feeFor(null, 'online'), 0)
  })
})

describe('an existing record is found whatever shape the number was stored in', () => {
  test('the shapes the shared helper guarantees', () => {
    /*
     * This uses lib/leads/importValidation's phoneVariants rather than a
     * local copy — tests/oneSourceOfTruth fails the build if this file grows
     * its own, because two lead lookups that disagree create the duplicate
     * they exist to prevent. So this asserts what the SHARED helper
     * guarantees, not what a private version happened to return.
     */
    const v = phoneVariants('233241234567')
    assert.ok(v.includes('233241234567'), 'the canonical form')
    assert.ok(v.includes('0241234567'), 'the local form')
    assert.ok(v.includes('241234567'), 'the bare local form')
    assert.equal(new Set(v).size, v.length, 'no duplicates')
  })

  test('the same number typed any way finds the same record', () => {
    const canon = phoneVariants('233241234567').sort()
    for (const typed of ['0241234567', '+233 24 123 4567', '00233241234567']) {
      assert.deepEqual(phoneVariants(typed).sort(), canon, `${typed} searched different shapes`)
    }
  })
})

describe('permissions', () => {
  const portalsFor = (role: string) => resolvePortals(role, null)

  test('academic management reaches the route', () => {
    assert.equal(canReachApi('/api/academics/manual-registration', 'project_manager', portalsFor('project_manager')), true)
    assert.equal(canReachApi('/api/academics/manual-registration', 'super_admin', portalsFor('super_admin')), true)
  })

  test('nobody else does', () => {
    for (const role of ['trainer', 'accountant', 'marketing_officer', 'receptionist', 'student']) {
      assert.equal(
        canReachApi('/api/academics/manual-registration', role, portalsFor(role)), false,
        `${role} could reach manual registration`,
      )
    }
  })

  test('the route’s own role list matches who can open the page', () => {
    // A role that sees the button and gets a 403 is the trap this prevents.
    const s = code(ROUTE)
    const m = /const ALLOWED = \[([^\]]*)\]/.exec(s)
    assert.ok(m)
    const roles = m[1].split(',').map(r => r.trim().replace(/['"]/g, '')).filter(Boolean).sort()
    const holders = ['super_admin', 'project_manager', 'administrator', 'accountant', 'trainer',
      'admissions_officer', 'marketing_officer', 'receptionist', 'exam_coordinator', 'student']
      .filter(r => resolvePortals(r, null).includes('academics'))
      .sort()
    assert.deepEqual(roles, holders,
      'the route accepts a different set of roles than the academics portal grants')
  })
})

describe('the student lands in the records the rest of the portal reads', () => {
  const s = code(ROUTE)

  test('it runs the canonical registration rather than reimplementing it', () => {
    assert.match(s, /completeApplication\(application\.id\)/,
      'the lead chain, admission number and fee ledger must come from the canonical path')
  })

  test('no payment reference is ever passed', () => {
    /*
     * completeApplication(id, paystackRef) marks the application PAID when a
     * reference is given. Registering a student must never record money.
     */
    assert.doesNotMatch(s, /completeApplication\([^)]*,[^)]*\)/,
      'a second argument to completeApplication would mark the application paid')
    assert.match(s, /payment_status: 'pending'/)
    assert.doesNotMatch(s, /payment_status: 'paid'/)
    assert.doesNotMatch(s, /paid_at|paystack_ref/)
  })

  test('the fee is written owing, with nothing paid', () => {
    assert.match(s, /amount_paid: 0/)
    assert.match(s, /status: total > 0 \? 'owing' : 'paid'/)
  })

  test('it writes an application, not a parallel students table', () => {
    assert.match(s, /from\('applications'\)[\s\S]{0,80}\.insert\(/)
    assert.doesNotMatch(s, /manual_students|from\('students'\)/)
  })

  test('the accountant’s visibility is verified, not assumed', () => {
    // createFeeLedger swallows its own errors, so a missing fee row would
    // otherwise be silent — and silence here means invisible to Accounts.
    assert.match(s, /from\('student_fees'\)[\s\S]{0,120}\.eq\('application_id'/)
    assert.match(s, /visibleToAccounts/)
  })

  test('a failed registration leaves nothing behind', () => {
    assert.match(s, /from\('applications'\)\.delete\(\)\.eq\('id', application\.id\)/,
      'an application whose chain failed must not be left as a half-registration')
  })

  test('registering twice for the same programme is refused', () => {
    assert.match(s, /status: 409/)
    assert.match(s, /\.in\('phone', variants\)\.eq\('course_id'/)
  })

  test('the class seat is upserted on the same key the existing route uses', () => {
    assert.match(s, /onConflict: 'batch_id,application_id'/)
  })

  test('no money is written onto the class enrolment', () => {
    // student_fees owns the balance. An amount here too is how one student
    // acquires two balances.
    const seat = s.slice(s.indexOf("from('class_enrollments')"), s.indexOf('onConflict'))
    for (const col of ['total_fee', 'amount_paid', 'balance']) {
      assert.ok(!seat.includes(col), `${col} must not be written onto the enrolment`)
    }
  })

  test('the registration is marked as manual', () => {
    assert.match(s, /registration_source: MANUAL_SOURCE/)
    assert.equal(MANUAL_SOURCE, 'manual')
  })

  test('an existing lead keeps the source it really came from', () => {
    assert.match(s, /leadExistedBefore/,
      'a Facebook lead registered at the desk still came from Facebook')
  })

  test('who did it, and when, is recorded', () => {
    assert.match(s, /recordAudit\(/)
    assert.match(s, /action: 'student\.manual_register'/)
  })
})

describe('the migration enables exactly what the schema blocked', () => {
  const sql = readFileSync('supabase/migrations/0025_manual_registration.sql', 'utf8')

  test('an application may have no email', () => {
    assert.match(sql, /ALTER COLUMN email DROP NOT NULL/)
  })

  test('the source of a registration is recorded, defaulting to online', () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS registration_source/)
    assert.match(sql, /DEFAULT 'online'/)
  })

  test('it is in the pending bundle, or it never runs', () => {
    const bundle = readFileSync('supabase/migrations/APPLY-ALL-PENDING.sql', 'utf8')
    assert.match(bundle, /registration_source/)
  })
})

describe('the academic screen offers it', () => {
  const page = readFileSync('app/(portal)/admin/academics/page.tsx', 'utf8')
  const dialog = readFileSync('components/academics/ManualRegistrationDialog.tsx', 'utf8')

  test('the button is on the academics page', () => {
    assert.match(page, /Register Student Manually/)
    assert.match(page, /ManualRegistrationDialog/)
  })

  test('the list reloads from the server afterwards', () => {
    // Not by pushing the new row into local state: the record shown should be
    // the one that was actually saved.
    assert.match(page, /onRegistered=\{\(\) => \{ refetch/)
  })

  test('a double tap cannot register twice', () => {
    assert.match(dialog, /if \(saving\) return/)
    assert.match(dialog, /disabled=\{saving\}/)
  })

  test('what was typed survives a rejected submit', () => {
    assert.doesNotMatch(dialog, /reset\(\)[\s\S]{0,40}setErrors\(d\.fields\)/)
    assert.match(dialog, /if \(d\.fields\) setErrors\(d\.fields\)/)
  })

  test('it says that no payment is being recorded', () => {
    assert.match(dialog, /owing/)
    assert.match(dialog, /No payment is recorded/i)
  })
})

describe('the migration runner picks the right migrations', () => {
  /*
   * scripts/apply-migrations.sh globs 000*.sql, which matches 0001 to 0009
   * and nothing else. Run against the live database it would skip every
   * pending migration AND re-run 0001, which deletes every pin_sessions row
   * and forces a PIN reset on every profile. The allow-rule in
   * .claude/settings.local.json names that script, so the trap is one
   * keystroke away.
   */
  test('the fresh-database script says it is for a fresh database', () => {
    const s = readFileSync('scripts/apply-migrations.sh', 'utf8')
    assert.match(s, /FOR A FRESH DATABASE ONLY/)
    assert.match(s, /apply-pending-migrations\.sh/, 'it must point at the right one')
  })

  test('the pending runner starts at 0018 and is ordered', () => {
    const raw = readFileSync('scripts/apply-pending-migrations.sh', 'utf8')
    // Strip shell comments: the script EXPLAINS the bad glob, and matching
    // my own prose is not the same as matching the code. This assertion
    // failed on exactly that.
    const s = raw.replace(/^\s*#.*$/gm, '')
    assert.match(s, /FROM="\$\{FROM_MIGRATION:-0018\}"/)
    assert.match(s, /\[0-9\]\[0-9\]\[0-9\]\[0-9\]_\*\.sql/,
      'a four-digit glob, so 0010 and later are not skipped')
    assert.doesNotMatch(s, /000\*\.sql/, 'the glob that caused this')
  })

  test('it verifies the two things that matter after running', () => {
    const s = readFileSync('scripts/apply-pending-migrations.sh', 'utf8')
    assert.match(s, /relrowsecurity=false/, 'RLS coverage, which is CB-026')
    assert.match(s, /registration_source/, 'the column this feature needs')
  })

  test('every pending migration is idempotent, so re-running is safe', () => {
    // The runner has no record of what has already been applied; it relies on
    // each file being a no-op the second time.
    for (const n of ['0023_rls_on_exposed_tables', '0024_payment_reminders_off', '0025_manual_registration']) {
      const sql = readFileSync(`supabase/migrations/${n}.sql`, 'utf8')
      assert.match(sql, /IF NOT EXISTS|ON CONFLICT|DROP NOT NULL|ENABLE ROW LEVEL SECURITY/i,
        `${n} is not written to survive a second run`)
    }
  })
})

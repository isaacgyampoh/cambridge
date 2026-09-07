import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canRead, canWrite, ownerColumnFor, leadAccessFor } from '../lib/data/policy.ts'
import { ROLE_DEFAULTS, resolvePortals, PORTAL_PATHS } from '../lib/access/portals.ts'

/**
 * THE FOUR WORKFLOWS STAFF ACTUALLY REPORTED BROKEN.
 *
 * Manual lead entry, distributed leads arriving, the SMS that announces them,
 * and an accountant reaching school fees. Each root cause is written down at
 * the test that would have caught it.
 */

/**
 * A file with its comments removed.
 *
 * These tests assert things like "the form no longer posts to the bulk import
 * route" — and the fix carries a comment EXPLAINING that it used to, quoting
 * the old call. Reading the raw file makes the documentation of a fix look
 * exactly like the bug, so three of these passed against the broken code and
 * failed against the correct code. Assertions are made against the code.
 */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments, JSDoc included
    .replace(/^\s*\/\/.*$/gm, '')       // whole-line // comments
}

/** Every role that can be handed a lead by the distributor. */
const LEAD_RECIPIENTS = Object.keys(ROLE_DEFAULTS)
  .filter(r => resolvePortals(r, null).includes('my_leads'))

describe('a lead recipient can see the leads they are given', () => {
  /*
   * ── ROOT CAUSE ────────────────────────────────────────────────────────
   *
   * Eligibility to RECEIVE a lead was decided by the portal system
   * (lib/leads/eligibility: you qualify if your portals include `my_leads`).
   * Permission to READ the leads table was decided somewhere else entirely —
   * a hand-kept list of role names in lib/data/policy.
   *
   * Two lists answering one question, and they disagreed. `content_manager`
   * holds `my_leads` by default, so the distributor picked them and wrote the
   * assignment correctly — and READ_TABLES gave them no access to `leads`, so
   * /api/data answered 403 and their portal stayed empty. From the marketing
   * side that is indistinguishable from the lead never arriving.
   */
  test('every role eligible for a lead can read the leads table', () => {
    const blind = LEAD_RECIPIENTS.filter(r => !canRead('leads', r, null))
    assert.deepEqual(blind, [],
      'these roles are given leads they cannot see — the assignment succeeds ' +
      'and their portal stays empty:\n  ' + blind.join('\n  '))
  })

  test('and can work the lead once they have it', () => {
    for (const role of LEAD_RECIPIENTS) {
      for (const table of ['leads', 'lead_activities', 'lead_comments']) {
        assert.ok(canWrite(table, role, null),
          `${role} receives leads but cannot write ${table} — every action on the lead is refused`)
      }
    }
  })

  test('a recipient sees only their own leads, not the whole board', () => {
    // The oversight roles are the deliberate exception: they distribute,
    // report on, or reconcile against leads they do not personally own.
    const oversight = ['super_admin', 'administrator', 'project_manager', 'admissions_officer', 'accountant']
    for (const role of LEAD_RECIPIENTS.filter(r => !oversight.includes(r))) {
      assert.equal(ownerColumnFor('leads', role, null), 'assigned_to',
        `${role} can read leads that were never assigned to them`)
    }
  })

  test('a role with no lead portal reads no leads at all', () => {
    for (const role of ['receptionist', 'student']) {
      assert.equal(canRead('leads', role, null), false, `${role} can read leads`)
      assert.equal(leadAccessFor(role, null), null)
    }
  })

  /*
   * The staff permissions screen can grant `my_leads` to anybody. Under the
   * old role-name list that made them a lead recipient whose reads were
   * refused — the same bug, created through the UI, with nothing to warn
   * anyone. Access is derived from the granted portal now.
   */
  test('granting my_leads from the staff screen actually works', () => {
    const granted = ['reminders', 'clock_in', 'my_leads']
    assert.ok(canRead('leads', 'receptionist', granted),
      'a receptionist granted my_leads is eligible for leads but cannot read them')
    assert.equal(ownerColumnFor('leads', 'receptionist', granted), 'assigned_to',
      'and would see everybody else’s leads')
  })

  test('revoking my_leads takes lead access away again', () => {
    const granted = ['dashboard', 'clock_in']
    assert.equal(canRead('leads', 'content_manager', granted), false)
  })

  test('every lead recipient has somewhere to read them', () => {
    for (const role of LEAD_RECIPIENTS) {
      const paths = resolvePortals(role, null).flatMap(p => PORTAL_PATHS[p] || [])
      assert.ok(paths.includes('/marketer/leads'),
        `${role} can be given leads but cannot open the page that lists them`)
    }
  })
})

describe('an accountant can open school fees', () => {
  /*
   * ── ROOT CAUSE ────────────────────────────────────────────────────────
   *
   * The page reads `student_fees` through /api/data, and student_fees was in
   * no role's READ_TABLES at all — only the super_admin/administrator
   * wildcard reached it. So an accountant navigated to the page (the portal
   * and the route guard both allowed it) and the table came back 403.
   *
   * Navigation was never the problem, which is why it looked like the page
   * was broken rather than the permission.
   */
  test('the fees table is readable by the finance roles', () => {
    // The same list /api/fees/verify guards with.
    for (const role of ['accountant', 'project_manager', 'super_admin']) {
      assert.ok(canRead('student_fees', role, null),
        `${role} guards /api/fees/* but cannot read student_fees`)
    }
  })

  test('an accountant can record and verify a payment', () => {
    for (const table of ['student_fees', 'payments', 'invoices']) {
      assert.ok(canWrite(table, 'accountant', null), `an accountant cannot write ${table}`)
    }
  })

  test('and school fees is in their navigation', () => {
    const paths = resolvePortals('accountant', null).flatMap(p => PORTAL_PATHS[p] || [])
    assert.ok(paths.some(p => '/finance/student-fees'.startsWith(p)),
      'the route guard does not admit an accountant to /finance/student-fees')
  })

  test('least privilege is preserved — this is not admin access', () => {
    // The point of the fix is the fees capability, not the run of the system.
    for (const table of ['profiles_secrets', 'audit_log', 'pin_sessions']) {
      assert.equal(canRead(table, 'accountant', null), false,
        `an accountant can read ${table}`)
    }
    const paths = resolvePortals('accountant', null).flatMap(p => PORTAL_PATHS[p] || [])
    for (const forbidden of ['/admin/staff', '/admin/settings', '/admin/whatsapp']) {
      assert.ok(!paths.includes(forbidden), `an accountant reaches ${forbidden}`)
    }
  })
})

describe('adding a lead by hand', () => {
  const route = codeOf('app/api/leads/create/route.ts')
  const form = codeOf('app/(portal)/marketer/leads/new/page.tsx')

  /*
   * ── ROOT CAUSE ────────────────────────────────────────────────────────
   *
   * The form was rewired to post to /api/leads/import — the BULK route,
   * guarded by portals ['leads', 'pm_leads']. A marketing officer holds
   * neither; their lead portal is `my_leads`. So every marketer, trainer,
   * content manager and exam coordinator who filled the form in got
   * "You do not have access to this." for a lead they had sourced themselves.
   *
   * Before the rewiring it posted to /api/data, which marketers may write —
   * so this was a regression, not a feature that never worked.
   */
  test('the people who add their own leads can reach the route', () => {
    const guard = route.match(/withGuard\(\s*\{\s*portals:\s*\[([^\]]+)\]/)
    assert.ok(guard, 'the create route is not portal-guarded')
    const allowed = guard[1].split(',').map(s => s.trim().replace(/['"]/g, ''))

    for (const role of LEAD_RECIPIENTS) {
      const held = resolvePortals(role, null)
      assert.ok(allowed.some(p => held.includes(p)),
        `${role} can be given leads but cannot add one — this is the reported bug`)
    }
  })

  test('the form no longer posts to the bulk import route', () => {
    assert.ok(!/fetch\(\s*['"`]\/api\/leads\/import/.test(form),
      'Add lead still posts to the bulk route, which marketers cannot reach')
    assert.match(form, /fetch\(\s*['"`]\/api\/leads\/create/)
  })

  /*
   * The old form sent `assigned_to: myId`, read from /api/auth/me — a value
   * the browser supplies and can therefore change.
   */
  test('attribution is resolved server-side, not taken from the browser', () => {
    // The body's assigned_to may only ever be reached through the
    // distributor check; a non-distributor gets session.userId.
    assert.match(route, /distributes\s*\n?\s*\?\s*\(body\.assigned_to \|\| null\)\s*\n?\s*:\s*session\.userId/,
      'the owner is not resolved from the session')
    assert.ok(!/assigned_to:\s*myId/.test(form),
      'the form still sends a client-supplied owner')
    assert.ok(!/auth\/me/.test(form),
      'the form still reads its own identity from the browser to send as attribution')
  })

  test('only a distributor may name someone else, and only if eligible', () => {
    assert.match(route, /isEligible\(owner\)/,
      'a lead can be assigned to somebody who cannot receive leads')
    assert.match(route, /DISTRIBUTOR_PORTALS = \['leads', 'pm_leads'\]/)
  })

  test('the fields the form collects are the fields that get saved', () => {
    // gender and notes are real columns. The import pipeline writes neither,
    // so everything typed into them was discarded while the form went
    // through it.
    for (const field of ['gender', 'notes', 'city', 'course_interest']) {
      assert.match(route, new RegExp(`${field}:\\s*body\\.${field}`),
        `${field} is collected by the form and never written`)
    }
  })

  test('a failed submission is never reported as success', () => {
    assert.match(form, /if \(!res\.ok \|\| !body\?\.success\)/,
      'the form decides success from a body field alone — a 500 or a redirect reads as success')
    assert.ok(!/catch \{\s*\}/.test(form), 'the form swallows an error')
  })

  test('a manual lead gets the same follow-through as a distributed one', () => {
    // Named owner: notify directly. No owner named by a distributor: the
    // same weighted lottery a distributed lead goes through, which notifies
    // as part of its own work.
    assert.match(route, /onLeadAssigned\(lead\.id, assignedTo\)/,
      'a manually added lead is not notified or enrolled in nurture — two lead models')
    assert.match(route, /autoAssignLead\(lead\.id, null, 'manual'\)/,
      'leaving the marketer blank no longer distributes the lead to the pool')
  })
})

describe('the SMS that announces assigned leads', () => {
  const route = codeOf('app/api/leads/notify-pending/route.ts')

  /*
   * ── ROOT CAUSE ────────────────────────────────────────────────────────
   *
   * The endpoint finished each marketer with
   *
   *     .update({ pending: 0, last_sms_at: ... })
   *
   * and lead_assign_pending has no last_sms_at column. PostgREST rejects the
   * whole statement, so `pending` was not cleared either — and the result was
   * never read, so nothing said so. The send itself was wrapped in `catch {}`.
   *
   * The two branches failed in opposite directions, which is why it was hard
   * to see: a marketer WITH a phone kept a standing count and was re-texted
   * every run; one with NO phone took the other branch, which has no
   * last_sms_at, succeeded, and was cleared silently — never told at all.
   */
  test('the count is cleared with columns that exist', () => {
    // The clearing statement must not name a column added by a migration
    // that may not have been applied yet.
    const clear = route.slice(route.indexOf('async function clearPending'))
    const stmt = clear.slice(0, clear.indexOf('if (error)'))
    assert.match(stmt, /\.update\(\{ pending: 0 \}\)/,
      'the clear names extra columns and will fail as a unit, as the original did')
  })

  test('the result of the clear is read', () => {
    assert.match(route, /const \{ error \} = await sb\.from\('lead_assign_pending'\)/,
      'the clear is fire-and-forget again')
  })

  test('nothing is swallowed by a bare catch', () => {
    assert.ok(!/catch \{\s*\}/.test(route),
      'a failure is being discarded silently — that is how this broke')
  })

  test('a failed send leaves the count standing so it retries', () => {
    assert.match(route, /if \(result\.queued \|\| result\.duplicate\)/,
      'the count is cleared regardless of whether the message was queued')
    assert.match(route, /attempts >= MAX_RUNS/,
      'a permanently failing row would be retried forever')
  })

  test('it goes through the SMS queue, so it is logged and retried', () => {
    assert.match(route, /queueSMS\(/,
      'sending directly bypasses sms_logs, retries and dedupe — the manual ' +
      'assign route uses the queue and this one did not')
    assert.match(route, /dedupeKey:/, 'a retry could text the same person twice')
  })

  test('a recipient with no phone is recorded, not silently dropped', () => {
    assert.match(route, /no phone on profile/,
      'somebody receiving leads with no phone number is a thing an ' +
      'administrator must be able to find out about')
  })

  test('the migration adding the columns exists', () => {
    const sql = readFileSync('supabase/migrations/0017_lead_notify_durability.sql', 'utf8')
    for (const col of ['last_sms_at', 'attempts', 'last_error']) {
      assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}`))
    }
  })
})

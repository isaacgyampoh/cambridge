import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  unwritableColumnsFor, GLOBALLY_UNWRITABLE, UNWRITABLE_BY_TABLE, canWrite,
} from '../lib/data/policy.ts'

/**
 * A WRITE THAT FAILS MUST NOT REPORT SUCCESS.
 *
 * The worst bugs in this system were not crashes. They were screens that did
 * nothing and said they had:
 *
 *   - Saving a member of staff's permissions wrote `portals` through
 *     /api/data, where the column is blocked. 400. Nothing read it. "Permissions
 *     updated for <name>!" — and not one permission had ever changed, for
 *     anybody. That is why granting somebody the Leads portal never fixed
 *     their missing leads.
 *
 *   - Deactivating a member of staff wrote `is_active` the same way. 400.
 *     "Deactivated" — and a person who had left kept working access.
 *
 *   - Assigning a lead PATCHed leads.assigned_to and THEN called the assign
 *     route, which found the lead already theirs, returned 409, and skipped
 *     the SMS, the WhatsApp, the audit row and the notification counter. The
 *     toast said "Marketer notified via SMS & WhatsApp."
 *
 *   - Toggling a course, a knowledge entry or a nurture sequence wrote
 *     `is_active` on those tables, where a profiles-shaped denylist blocked
 *     it globally. Creating a sequence failed outright for the same reason.
 */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** Source with comments blanked — they quote the old broken code. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const SCREENS = [...sourceFiles('app'), ...sourceFiles('components')]

describe('the denylist blocks what is dangerous and nothing else', () => {
  test('credentials and tokens are blocked on every table', () => {
    for (const col of ['pin_hash', 'session_token', 'otp_code', 'reset_token_hash', 'recovery_pin_hash']) {
      assert.ok(GLOBALLY_UNWRITABLE.includes(col), `${col} must never be writable anywhere`)
      // session_token lives on pin_sessions too; writing one is session forgery.
      assert.ok(unwritableColumnsFor('pin_sessions').includes(col))
      assert.ok(unwritableColumnsFor('leads').includes(col))
    }
  })

  test('access columns stay blocked on profiles', () => {
    for (const col of ['role', 'portals', 'is_active', 'permissions']) {
      assert.ok(unwritableColumnsFor('profiles').includes(col),
        `profiles.${col} decides who someone is — it must not be writable through /api/data`)
    }
    assert.deepEqual(Object.keys(UNWRITABLE_BY_TABLE), ['profiles'],
      'another table has been given access columns; check they are really access')
  })

  test('is_active is ordinary business data everywhere else', () => {
    // Four features were silently dead because a profiles-shaped rule was
    // applied to every table.
    for (const table of ['courses', 'knowledge_base', 'sequences']) {
      assert.ok(!unwritableColumnsFor(table).includes('is_active'),
        `${table}.is_active is blocked, so it cannot be switched on or off`)
    }
  })

  test('the check is made per table, not against one flat list', () => {
    const route = codeOf('app/api/data/route.ts')
    const uses = [...route.matchAll(/unwritableColumnsFor\(table\)/g)].length
    assert.equal(uses, 2, 'the insert and update paths must both scope by table')
    assert.ok(!/UNWRITABLE_COLUMNS\.includes/.test(route),
      'the flat list is being applied to every table again')
  })
})

describe('access changes go through the guarded route', () => {
  const route = codeOf('app/api/admin/staff-access/route.ts')

  test('it is guarded by the staff portal', () => {
    assert.match(route, /withGuard\(\{ portals: \['staff'\] \}/)
  })

  test('nobody can grant access they do not hold', () => {
    // Otherwise this screen — built for delegating access — becomes the way
    // an administrator promotes themselves.
    assert.match(route, /portals\.filter\(p => p !== 'dashboard' && !mine\.includes\(p\)\)/,
      'an administrator can grant themselves any portal')
  })

  test('the last super admin cannot be deactivated', () => {
    assert.match(route, /last active super admin/i,
      'the centre can be locked out of its own system')
    assert.match(route, /\.eq\('role', 'super_admin'\)\.eq\('is_active', true\)/)
  })

  test('you cannot deactivate yourself', () => {
    assert.match(route, /id === session\.userId && !is_active/)
  })

  test('only a super admin may change a super admin', () => {
    assert.match(route, /target\.role === 'super_admin' && !superAdmin/)
  })

  test('every change is audited', () => {
    assert.match(route, /action: 'staff\.access_changed'/)
  })

  test('the screens call it and read the answer', () => {
    for (const page of [
      'app/(portal)/admin/staff/page.tsx',
      'app/(portal)/admin/staff/[id]/page.tsx',
    ]) {
      const src = codeOf(page)
      assert.match(src, /\/api\/admin\/staff-access/, `${page} does not use the guarded route`)
      assert.match(src, /if \(!res\.ok \|\| !d\?\.success\)/,
        `${page} announces success without reading the response`)
      // A READ of profiles through /api/data is fine — that is how the list
      // loads. What must not come back is a WRITE.
      assert.ok(!/method:\s*'PATCH'[\s\S]{0,200}table: 'profiles'/.test(src),
        `${page} still writes profiles through the generic endpoint, where the ` +
        'access columns are blocked and the failure is invisible')
    }
  })
})

describe('a lead is assigned once, by the route that notifies', () => {
  test('no screen writes leads.assigned_to itself', () => {
    /*
     * The PATCH made the lead already belong to the marketer, so
     * assign_lead_to hit
     *
     *     IF v_current IS NOT DISTINCT FROM p_marketer THEN RETURN FALSE
     *
     * the route answered 409, and everything past that early return never
     * ran: the SMS, the WhatsApp, the audit entry, the activity row, and
     * onLeadAssigned — which is what increments the pending-SMS counter.
     */
    const offenders = SCREENS.filter(f => {
      const src = codeOf(f)
      return /mutate\(\s*'PATCH',\s*'leads'/.test(src) && /assigned_to/.test(src)
    })
    assert.deepEqual(offenders, [],
      'these assign a lead by writing the column directly, which makes the ' +
      'assign route a no-op and silences every notification:\n  ' + offenders.join('\n  '))
  })

  test('both assign screens read the response', () => {
    for (const page of [
      'app/(portal)/pm/assign/page.tsx',
      'app/(portal)/pm/leads/[id]/page.tsx',
    ]) {
      const src = codeOf(page)
      assert.match(src, /if \(!res\.ok \|\| !d\?\.success\)/,
        `${page} reports an assignment that may have been refused`)
    }
  })

  test('the toast no longer promises messages the route may not have sent', () => {
    const src = codeOf('app/(portal)/pm/assign/page.tsx')
    assert.ok(!/notified via SMS & WhatsApp/.test(src),
      'the screen still promises SMS and WhatsApp regardless of what happened')
  })

  test('the route records who assigned it', () => {
    // assign_lead_to writes the actor to lead_assignments but not to
    // leads.assigned_by, which the admin list displays. The PATCH used to do
    // it; the route does it now, so no caller needs to write leads at all.
    const route = codeOf('app/api/leads/assign/route.ts')
    assert.match(route, /update\(\{ assigned_by: session\.userId \}\)/)
  })
})

describe('no write goes out through a raw fetch to the generic endpoint', () => {
  /*
   * mutate() throws on a refusal. A hand-rolled fetch to the same endpoint
   * does not, so every one of these announced success whatever came back.
   * Four were failing today rather than latently: the auto-assign switch, a
   * WhatsApp intro line, a class fee marked paid by an administrator, and
   * marking notifications read.
   */
  test('every /api/data write uses mutate', () => {
    const offenders: string[] = []

    for (const file of SCREENS) {
      const src = codeOf(file)
      for (const m of src.matchAll(/fetch\(\s*['"`]\/api\/data['"`]\s*,\s*\{([\s\S]{0,200})/g)) {
        if (!/method:\s*'(POST|PATCH|DELETE)'/.test(m[1])) continue   // reads are fine
        const line = src.slice(0, m.index).split('\n').length
        offenders.push(`${file}:${line}`)
      }
    }

    assert.deepEqual(offenders, [],
      'these write through the generic endpoint without mutate(), so a 400 ' +
      'or 403 is invisible and the screen reports success:\n  ' + offenders.join('\n  '))
  })

  test('the auto-assign switch reverts when the write is refused', () => {
    // It decides whether incoming leads are distributed at all, and it used
    // to flip optimistically into a bare catch {}.
    const src = codeOf('app/(portal)/admin/settings/page.tsx')
    assert.match(src, /const previous = autoAssign/,
      'the switch has nothing to revert to')
    assert.match(src, /setAutoAssign\(previous\)/,
      'a refused write leaves the switch showing a setting the database does not hold')
  })

  test('the notification bell puts the badge back on failure', () => {
    const src = codeOf('components/shared/NotificationBell.tsx')
    assert.equal([...src.matchAll(/setItems\(before\)/g)].length, 2,
      'marking read still swallows failures, so the count returns unexplained')
  })

  test('marking all read is one request, not one per notification', () => {
    const src = codeOf('components/shared/NotificationBell.tsx')
    assert.match(src, /op: 'in', val: unread/,
      'twenty unread notifications means twenty round trips in series')
  })

  test('an administrator can work class enrolments', () => {
    // batches, class_sessions, class_signins and attendance were all present;
    // class_enrollments was not, and /admin/classes is on the academics
    // portal an administrator holds.
    for (const table of ['batches', 'class_sessions', 'attendance', 'class_enrollments']) {
      assert.ok(canWrite(table, 'administrator', null),
        `an administrator runs academics but cannot write ${table}`)
    }
  })
})

describe('bulk updates name their rows and nothing more', () => {
  const route = codeOf('app/api/data/route.ts')

  test('an update accepts eq and in', () => {
    assert.match(route, /if \(op === 'in'\)/)
    assert.match(route, /query\.in\(col, val as string\[\]\)/)
  })

  test('and refuses the comparison operators', () => {
    /*
     * `in` names specific rows — the same reach a loop of eq requests always
     * had. `neq`, `gt` and friends would let one request sweep a whole table,
     * which is a different and much larger thing.
     */
    assert.match(route, /Updates cannot filter with/,
      'an update can filter with any operator, so one request can sweep a table')
  })

  test('an in-list is bounded and must be a real list', () => {
    assert.match(route, /!Array\.isArray\(val\) \|\| !val\.length \|\| val\.length > MAX_LIMIT/)
  })
})

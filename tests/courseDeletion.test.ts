import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * A COURSE CAN BE REMOVED, AND A REGISTRATION CANNOT BE REMOVED WITH IT.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * /admin/courses offered create, edit and is_active, and nothing else. The
 * courses entered while the system was being demonstrated could never leave
 * the list — only be disabled, which still shows them.
 *
 * ── WHAT MUST NOT BECOME TRUE WHILE FIXING IT ──────────────────────────────
 *
 * Five tables carry course_id, and two of them — invoices and certificates —
 * are the record that a student paid and qualified. The tempting fix is ON
 * DELETE CASCADE, which turns a tidy-up into silent destruction of exactly
 * that. So the constraints stay as they are, the dependents are counted, and
 * the refusal explains itself.
 *
 * And the count has to be a real check: if a count read fails and its error
 * is dropped, the count is null, null is not greater than zero, and the
 * delete proceeds having proven nothing.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const route = codeOf('app/api/admin/delete-course/route.ts')
const screen = codeOf('app/(portal)/admin/courses/page.tsx')
const schema = readFileSync('supabase/FULL-SCHEMA.sql', 'utf8')

describe('the history a course carries is not destroyed with it', () => {
  test('no course reference is allowed to cascade', () => {
    /*
     * The guard this whole feature depends on. Postgres refusing the delete
     * is what makes a counting bug survivable.
     */
    for (const line of schema.split('\n')) {
      if (!/REFERENCES\s+courses\(id\)/.test(line)) continue
      assert.ok(!/ON DELETE (CASCADE|SET NULL)/i.test(line),
        `a course reference cascades, so deleting a course would destroy records: ${line.trim()}`)
    }
  })

  test('and the route does not add one of its own', () => {
    assert.ok(!/ON DELETE|ALTER TABLE|DROP CONSTRAINT/i.test(route),
      'The route must not relax the constraints it relies on.')
  })

  test('every table that points at a course is counted', () => {
    const referencing = new Set<string>()
    const lines = schema.split('\n')
    let current = ''
    for (const line of lines) {
      const created = line.match(/^CREATE TABLE (?:IF NOT EXISTS )?(\w+)/)
      if (created) current = created[1]
      if (/REFERENCES\s+courses\(id\)/.test(line) && current) referencing.add(current)
    }
    assert.ok(referencing.size >= 5, `expected the known dependents, found ${[...referencing]}`)
    for (const table of referencing) {
      assert.ok(new RegExp(`table: '${table}'`).test(route),
        `${table} references courses(id) but is never counted, so a delete would fail on a raw constraint error`)
    }
  })
})

describe('a failed count does not read as nothing to worry about', () => {
  test('the error of every count is checked, and stops the delete', () => {
    const loop = route.slice(route.indexOf('for (const dep of DEPENDENTS'))
    const body = loop.slice(0, loop.indexOf('if (blocking.length'))
    assert.match(body, /const \{ count, error \}/,
      'the count must destructure its error, not discard it')
    assert.match(body, /if \(error\) \{[\s\S]{0,200}return unavailable\(/,
      'a failed count must stop the operation')
    // The failure branch has to come first; checking count before error means
    // the delete has already been decided by the time the error is seen.
    assert.ok(body.indexOf('if (error)') < body.indexOf('if (count'),
      'the error must be handled before the count is trusted')
  })

  test('the course itself is read with its error checked too', () => {
    assert.match(route, /const \{ data: course, error: readError \}/)
    assert.match(route, /if \(readError\) return unavailable\(/)
  })

  test('a missing course is a 404, not a silent success', () => {
    assert.match(route, /if \(!course\) return NextResponse\.json\([\s\S]{0,80}status: 404/)
  })

  test('the delete result is not discarded', () => {
    assert.match(route, /const \{ error: deleteError \} = await sb\.from\('courses'\)\.delete\(\)/)
    assert.match(route, /if \(deleteError\) \{[\s\S]{0,300}return saveFailed\(/)
  })
})

describe('the refusal tells the operator what is in the way', () => {
  test('it names the dependents and their counts', () => {
    assert.match(route, /blocking\.push\(`\$\{count\} \$\{count === 1 \? dep\.one : dep\.many\}`\)/)
    assert.match(route, /still has \$\{listPhrase\(blocking\)\} attached/)
  })

  test('it offers the alternative that does work', () => {
    assert.match(route, /disable the course instead/i)
  })

  test('it is a 409, so the screen can tell it from an outage', () => {
    const refusal = route.slice(route.indexOf('if (blocking.length > 0)'))
    assert.match(refusal.slice(0, 700), /status: 409/)
  })

  test('the screen shows the server’s message rather than its own', () => {
    const fn = screen.slice(screen.indexOf('async function remove(c: Course)'))
    assert.match(fn.slice(0, 700), /messageFor\(e,/,
      'the refusal names what blocks the delete and must reach the operator')
    assert.match(fn.slice(0, 700), /postJson\('\/api\/admin\/delete-course'/,
      'a bare fetch does not throw, so a refusal would be announced as success')
  })
})

describe('who may do it, and what is recorded', () => {
  test('administrators only', () => {
    assert.match(route, /\['super_admin', 'administrator'\]\.includes\(session\.role \|\| ''\)/)
    assert.match(route, /status: 403/)
  })

  test('the session is verified, not trusted from the body', () => {
    assert.match(route, /verifySession\(token\)/)
    assert.ok(!/body\.role|body\?\.role/.test(route))
  })

  test('both the deletion and the refusal are audited', () => {
    assert.match(route, /action: 'courses\.deleted'/)
    assert.match(route, /action: 'courses\.delete_blocked'/)
  })

  test('the audit records the name, not just an internal id', () => {
    assert.match(route, /metadata: \{ name: course\.name \}/)
  })
})

describe('the operator is asked first', () => {
  test('there is a confirmation, and it says what is checked', () => {
    const fn = screen.slice(screen.indexOf('async function remove(c: Course)'))
    assert.match(fn.slice(0, 700), /await confirm\(\{/)
    assert.match(fn.slice(0, 700), /if \(!await confirm/,
      'a declined confirmation must stop the delete')
  })

  test('the dialog is actually rendered', () => {
    // useConfirm returns a node; without it the promise never resolves.
    assert.match(screen, /const \{ confirm, dialog \} = useConfirm\(\)/)
    assert.match(screen, /\{dialog\}/)
  })

  test('disabling is still available, since it is the fallback offered', () => {
    assert.match(screen, /c\.is_active \? 'Disable' : 'Enable'/)
  })
})

describe('the phrasing of a list of blockers', () => {
  /**
   * Reimplemented, because the route imports server-only modules the test
   * runner cannot resolve. The assertion below pins the shipped source so
   * this cannot drift into testing a fiction.
   */
  function listPhrase(parts: string[]): string {
    if (parts.length === 1) return parts[0]
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  }

  test('one blocker reads plainly', () => {
    assert.equal(listPhrase(['3 invoices']), '3 invoices')
  })

  test('two are joined with "and", not a comma', () => {
    assert.equal(listPhrase(['2 classes', '1 application']), '2 classes and 1 application')
  })

  test('three read as a sentence', () => {
    assert.equal(listPhrase(['2 classes', '1 application', '4 invoices']),
      '2 classes, 1 application and 4 invoices')
  })

  test('singular and plural are both handled', () => {
    assert.match(route, /one: 'class',\s+many: 'classes'/)
    assert.match(route, /count === 1 \? dep\.one : dep\.many/)
  })

  test('the shipped implementation is the one reproduced here', () => {
    assert.match(route, /return `\$\{parts\.slice\(0, -1\)\.join\(', '\)\} and \$\{parts\[parts\.length - 1\]\}`/)
  })
})

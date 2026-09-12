import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE COURSE DATA FLOW, END TO END.
 *
 * ── THE AUDIT THAT GOT IT WRONG ────────────────────────────────────────────
 *
 * A previous pass of this system reported, in writing, that the centre had no
 * active courses. Two independent endpoints agreed, so the conclusion looked
 * well-founded.
 *
 * It was wrong. The LOCAL service key was invalid, every server-side read was
 * failing with a 401, and each of those endpoints turned the failure into an
 * empty array before anybody saw it:
 *
 *     const { data } = await sb.from('courses')...
 *     return { courses: (data || []).map(...) }
 *
 * Production had three courses with fees on them throughout. The failure was
 * unanimous, calm, and completely silent — which is the worst combination a
 * system can offer, because agreement between two broken readers looks like
 * corroboration.
 *
 * These tests are about that: a read that fails must never be able to present
 * itself as a table that is empty.
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

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('a failed courses read never looks like an empty table', () => {
  /*
   * The rule: anything that reads `courses` must look at the error. The
   * consequences of not doing so differ by caller and all of them are bad —
   * a prospectus that appears empty, an assistant with no fees, a registration
   * refused.
   */
  const READERS = [
    'app/api/courses/public/route.ts',
    'lib/chatbot/programme.ts',
    'lib/courseMatch.ts',
    'app/api/applications/submit/route.ts',
  ]

  for (const file of READERS) {
    test(`${file} reads the error`, () => {
      const code = codeOf(file)
      const reads = [...code.matchAll(/from\('courses'\)/g)]
      assert.ok(reads.length > 0, 'expected this file to read courses')

      // Every destructure of a courses read must take `error` as well as data.
      const blind = [...code.matchAll(/const \{ data(?::\s*\w+)? \}\s*=\s*await sb\s*\n?\s*\.?from\('courses'\)/g)]
      assert.deepEqual(blind.map(m => m[0].slice(0, 40)), [],
        'a courses read here discards its error, so a database failure is ' +
        'indistinguishable from a centre with no courses')
    })
  }

  test('the public endpoint answers 503 rather than an empty list', () => {
    const code = codeOf('app/api/courses/public/route.ts')
    assert.match(code, /if \(error\)/)
    assert.match(code, /status: 503/,
      'a refused read still answers 200 with an empty list, which reads as "no courses"')
  })

  test('registration does not tell an applicant the programme is closed', () => {
    /*
     * The sharpest instance. `course === null` meant "not open for
     * registration", so an unreachable database turned somebody trying to pay
     * into somebody told the course was closed.
     */
    const code = codeOf('app/api/applications/submit/route.ts')
    assert.match(code, /if \(courseErr\)/,
      'a failed programme check is still reported as the programme being closed')
    assert.match(code, /could not confirm that programme just now/i)
    assert.match(code, /status: 503/)
  })

  test('the assistant’s loader reports failure distinctly', () => {
    const code = codeOf('lib/chatbot/programme.ts')
    assert.match(code, /return \{ ok: false, error/)
    assert.match(code, /return \{ ok: true, data: \[\] \}/,
      'an empty centre must still be reportable as a success')
  })
})

describe('one canonical fee field, read the same way everywhere', () => {
  test('no query anywhere selects courses.price', () => {
    const offenders: string[] = []
    for (const file of [...sourceFiles('app'), ...sourceFiles('lib')]) {
      const code = codeOf(file)
      for (const m of code.matchAll(/\.select\(\s*['"`]([^'"`]*)['"`]/g)) {
        if (m[1].split(',').map(c => c.trim()).includes('price')) {
          offenders.push(`${file}: ${m[1].slice(0, 60)}`)
        }
      }
    }
    assert.deepEqual(offenders, [],
      'nothing in this application writes `price`; the canonical fee is ' +
      'course_fee:\n  ' + offenders.join('\n  '))
  })

  test('the admin writes exactly what the loaders read', () => {
    const admin = codeOf('app/(portal)/admin/courses/page.tsx')
    const loader = codeOf('lib/chatbot/programme.ts')
    for (const field of ['course_fee', 'course_fee_online', 'registration_fee']) {
      assert.ok(admin.includes(field), `the admin form no longer writes ${field}`)
      assert.ok(loader.includes(field), `the programme loader no longer reads ${field}`)
    }
  })
})

describe('the public site shows both delivery modes', () => {
  /*
   * A programme runs in person and online at different prices — course_fee
   * and course_fee_online. The page showed only the first, so a visitor saw
   * one number and had no way to learn the online cohort costs less, which is
   * the difference most likely to decide whether they enquire.
   */
  const page = codeOf('app/page.tsx')

  test('both fees are read', () => {
    assert.match(page, /const inPerson = ghs\(p\.feeInPerson\)/)
    assert.match(page, /const online = ghs\(p\.feeOnline\)/)
  })

  test('and both are shown when they differ', () => {
    assert.match(page, /bothDiffer/)
    assert.match(page, />In person</)
    assert.match(page, />Online</)
  })

  test('a programme with one fee shows one, not a blank row', () => {
    assert.match(page, /\(inPerson \|\| online\) \?/)
  })

  test('the public site reads the same loader the assistant does', () => {
    // Not its own query: two readers of one truth is how they drift.
    assert.match(page, /from '@\/lib\/chatbot\/programme'/)
    assert.ok(!/from\('courses'\)/.test(page),
      'the front page queries courses itself instead of using the canonical loader')
  })
})

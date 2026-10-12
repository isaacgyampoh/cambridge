import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * batch_students has nine readers and no writer.
 *
 * Nothing in app/, lib/ or scripts/ inserts a row, and no migration seeds or
 * triggers one — so every feature reading it shows an empty roster, which is
 * indistinguishable from a class that genuinely has no students. The live
 * roster is class_enrollments, keyed by lead_id.
 *
 * This test is the tripwire: if somebody adds the missing writer, it fails and
 * says so, because at that point the nine readers start working and the
 * warning comments should go. If somebody adds a TENTH silent reader, it fails
 * too.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

const sources = ['app', 'lib', 'scripts'].flatMap(d => walk(d))
const body = (p: string) => readFileSync(p, 'utf8')

describe('the two enrolment models are not quietly conflated', () => {
  test('nothing writes batch_students', () => {
    const writers: string[] = []
    for (const f of sources) {
      const s = body(f)
      // A write through the query builder: .from('batch_students')…insert/upsert/update
      if (/from\(\s*['"]batch_students['"]\s*\)[\s\S]{0,200}?\.(insert|upsert|update)\(/.test(s)) {
        writers.push(f)
      }
    }
    assert.deepEqual(writers, [],
      `batch_students now has a writer (${writers.join(', ')}). ` +
      'If that is deliberate, the nine readers can work — remove the warning ' +
      'comments and this assertion. If it is not, it is a second enrolment model.')
  })

  test('class_enrollments is the one that is written', () => {
    const writers = sources.filter(f =>
      /from\(\s*['"]class_enrollments['"]\s*\)[\s\S]{0,200}?\.(insert|upsert|update)\(/.test(body(f)))
    // Proves the pair is genuinely asymmetric rather than both being dead,
    // which would make the finding something else entirely.
    assert.ok(writers.length > 0,
      'class_enrollments is read as the live roster but nothing writes it either — ' +
      'then neither model is populated by this application, which is a different problem')
  })

  test('the known readers of batch_students are the ones we have accounted for', () => {
    const readers = sources
      .filter(f => /from\(\s*['"]batch_students['"]\s*\)|table: 'batch_students'/.test(body(f)))
      .map(f => f.replace(/\\/g, '/'))
      .sort()

    // Accounted for in CB-032. A new entry here is a tenth feature that will
    // silently show nothing.
    /*
     * Four of the original nine have been repointed to class_enrollments —
     * the ones that needed only a batch_id, a name and a number, which the
     * roster carries inline.
     *
     * These five remain, and each is blocked on the same question rather than
     * on effort: they read or write a column keyed to profiles(id), and a
     * student in class_enrollments is a LEAD. Repointing them means deciding
     * how a lead relates to a profile, which is CB-032.
     *
     *   student/page + next-class   read batch_students by the signed-in
     *                               profile id
     *   trainer/classes             writes attendance.student_id
     *   attendance/auto-send        queries admissions by student_id
     *   reminders/personalized      writes a log row keyed by student_id
     */
    const known = [
      'app/(portal)/student/page.tsx',
      'app/(portal)/trainer/classes/page.tsx',
      'app/api/reminders/personalized/route.ts',
      'app/api/student/next-class/route.ts',
    ].sort()

    assert.deepEqual(readers, known,
      'the set of features reading the unwritten roster has changed')
  })
})

describe('a script does not keep its own copy of the phone normaliser', () => {
  test('verify-enrolment imports canonicalGhanaMobile', () => {
    const s = body('scripts/verify-enrolment.ts')
    assert.match(s, /import \{ canonicalGhanaMobile \} from '\.\.\/lib\/phone\.ts'/,
      'it must use the one canonical normaliser')
  })

  test('and does not redefine it', () => {
    const s = body('scripts/verify-enrolment.ts')
    assert.doesNotMatch(s, /function canonicalGhanaMobile/,
      'a hand-copied normaliser had already drifted: it accepted a bare ' +
      'nine-digit number that lib/phone.ts rejects, which would have ' +
      'over-reported the very match rate the script measures')
  })
})

describe('the readers that could be repointed, were', () => {
  const read = (p: string) => readFileSync(p, 'utf8')

  test('a broadcast to one class reaches the roster that exists', () => {
    for (const p of ['app/api/broadcast/route.ts', 'app/api/broadcast/send-now/route.ts']) {
      const s = read(p)
      assert.match(s, /from\('class_enrollments'\)/, `${p} still reads the empty table`)
      assert.doesNotMatch(s, /from\('batch_students'\)/, `${p} still reads batch_students`)
    }
  })

  test('the trainer’s student count comes from the roster', () => {
    const s = read('app/api/trainer/dashboard/route.ts')
    assert.match(s, /from\('class_enrollments'\)/)
    assert.doesNotMatch(s, /from\('batch_students'\)/)
  })

  test('class reminders find the students', () => {
    const s = read('app/api/reminders/route.ts')
    assert.match(s, /from\('class_enrollments'\)/)
    assert.doesNotMatch(s, /from\('batch_students'\)/)
  })

  test('only active enrolments are messaged', () => {
    // /api/classes/complete sets 'completed'. Somebody who has finished the
    // course should not be reminded to attend it.
    for (const p of ['app/api/broadcast/route.ts', 'app/api/broadcast/send-now/route.ts',
                     'app/api/reminders/route.ts', 'app/api/trainer/dashboard/route.ts']) {
      assert.match(read(p), /\.eq\('status', 'active'\)/, `${p} does not filter to active`)
    }
  })

  test('the sign-in link goes out, and is attributed', () => {
    const s = read('app/api/attendance/auto-send/route.ts')
    assert.match(s, /from\('class_enrollments'\)/, 'the roster must be the one that exists')
    assert.doesNotMatch(s, /from\('batch_students'\)/)

    /*
     * The marketer lookup asked admissions for a row matching student_id, and
     * admissions.student_id is always NULL — nothing in the application ever
     * sets it. Every link went out unattributed, on top of the loop running
     * zero times.
     */
    assert.doesNotMatch(s, /\.eq\('student_id', student\.id\)/,
      'admissions.student_id is never populated')
    assert.match(s, /\.eq\('id', student\.lead_id/, 'the lead is the populated key')

    /*
     * Scoped to the lookup itself. A broader check tripped on the class
     * session insert's .select().single(), which is correct there — it
     * inserts exactly one row.
     */
    const lookup = s.slice(s.indexOf("from('leads')"), s.indexOf('const marketerId'))
    assert.match(lookup, /maybeSingle\(\)/,
      'single() reports no rows as an error; a student with no lead row is not an error')
  })

  test('no join to profiles is attempted', () => {
    // A student in class_enrollments is a lead. student:student_id(...) would
    // embed a staff profile and come back empty.
    for (const p of ['app/api/broadcast/route.ts', 'app/api/broadcast/send-now/route.ts',
                     'app/api/reminders/route.ts']) {
      assert.doesNotMatch(read(p), /student:student_id\(/, `${p} still embeds a profile`)
    }
  })
})

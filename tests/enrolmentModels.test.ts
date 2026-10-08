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
    const known = [
      'app/(portal)/student/page.tsx',
      'app/(portal)/trainer/classes/page.tsx',
      'app/api/attendance/auto-send/route.ts',
      'app/api/broadcast/route.ts',
      'app/api/broadcast/send-now/route.ts',
      'app/api/reminders/personalized/route.ts',
      'app/api/reminders/route.ts',
      'app/api/student/next-class/route.ts',
      'app/api/trainer/dashboard/route.ts',
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

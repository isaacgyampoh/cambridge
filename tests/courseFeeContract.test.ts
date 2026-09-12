import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { capabilityOf, describeProgramme, type Programme } from '../lib/chatbot/programmeRules.ts'
import { ghs } from '../lib/chatbot/format.ts'

/**
 * THE COURSE FEE DATA CONTRACT.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * Two loaders selected `courses.price`:
 *
 *   lib/courseMatch.ts
 *   lib/chatbot/knowledge.ts   (the chatbot's own course block)
 *
 * Nothing in this application has ever WRITTEN `price`. The canonical field is
 * `course_fee`, with `course_fee_online` and `registration_fee` beside it:
 * the Course interface declares all three, the admin screen that creates and
 * edits a course writes all three, and the academics, courses and invoice
 * screens all read course_fee.
 *
 * PostgREST fails the WHOLE select on a column that does not exist. So either
 * those reads returned nothing at all, or they returned a field nobody
 * populates. Either way no fee ever reached the assistant — while its prompt
 * told it to quote fees "only from the facts below".
 *
 * That is the exact condition the no-guessing rule exists to prevent, arrived
 * at from the other direction: not a model inventing a number, but a model
 * given no number and asked about price.
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

/** Source with comments blanked — they name the old field to explain it. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const ALL = [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('hooks')]

describe('nothing reads a course fee from a column nobody writes', () => {
  test('no query selects courses.price', () => {
    /*
     * The regression guard the brief asks for: this fails if somebody changes
     * a query back to `price`.
     */
    const offenders: string[] = []
    for (const file of ALL) {
      const code = codeOf(file)
      // A select string that names `price` as a column.
      for (const m of code.matchAll(/\.select\(\s*['"`]([^'"`]*)['"`]/g)) {
        const columns = m[1].split(',').map(c => c.trim())
        if (columns.includes('price')) {
          offenders.push(`${file}: .select('${m[1].slice(0, 70)}')`)
        }
      }
    }
    assert.deepEqual(offenders, [],
      'these select `price`, which nothing in this application writes — and a ' +
      'missing column fails the entire select, so no fee reaches the caller:\n  '
      + offenders.join('\n  '))
  })

  test('the Course type still declares course_fee as the canonical field', () => {
    const types = readFileSync('types/index.ts', 'utf8')
    const course = types.slice(types.indexOf('export interface Course'), types.indexOf('export interface Batch'))
    assert.match(course, /course_fee:\s*number/,
      'the canonical fee field has been renamed; every loader must follow')
    assert.ok(!/\bprice\b/.test(course),
      'the Course type gained a price field — decide which is canonical and make all paths agree')
  })

  test('the admin write path and the chatbot read path name the same field', () => {
    // The write: the screen that creates and edits a course.
    const admin = codeOf('app/(portal)/admin/courses/page.tsx')
    assert.match(admin, /course_fee/, 'the admin screen no longer writes course_fee')

    // The read: the chatbot's programme loader.
    const loader = codeOf('lib/chatbot/programme.ts')
    assert.match(loader, /course_fee, course_fee_online, registration_fee/,
      'the programme loader no longer reads the fields the admin screen writes')
  })

  test('course matching reads the canonical field too', () => {
    const match = codeOf('lib/courseMatch.ts')
    assert.match(match, /course_fee/)
    assert.ok(!/\bprice\b/.test(match))
  })

  test('the programme loader owns programme facts alone', () => {
    /*
     * The knowledge loader used to read courses as well, with the wrong field.
     * Two sources of one truth would let the programme block say
     * "Fee: GHS 2,500" while the knowledge block listed the same programme
     * with no fee beside it — and a contradiction in the context is worse
     * than a gap.
     */
    const knowledge = codeOf('lib/chatbot/knowledge.ts')
    assert.ok(!/from\('courses'\)/.test(knowledge),
      'the knowledge loader reads courses again — that is a second source of fee truth')
    assert.ok(!/from\('batches'\)/.test(knowledge),
      'the knowledge loader reads cohorts again — that is a second source of date truth')
  })
})

describe('a real fee reaches the model, and a missing one does not become a number', () => {
  function programme(over: Partial<Programme> = {}): Programme {
    return {
      id: 'p1', name: 'Airbnb Management Masterclass', code: 'AIRBNB',
      description: null, duration: null,
      feeInPerson: null, feeOnline: null, registrationFee: null,
      brochureUrl: null, cohorts: [],
      ...over,
    }
  }

  test('course_fee = 2500 reaches the context as GHS 2,500', () => {
    // The flow the brief asks to be proved: admin writes 2500, the loader maps
    // course_fee to feeInPerson, the context states it, the model sees it.
    const p = programme({ feeInPerson: 2500 })
    const text = describeProgramme(p, capabilityOf(p, null))
    assert.match(text, /Fee: GHS 2,500 in person/)
    assert.ok(!/NOT RECORDED/.test(text))
  })

  test('the loader maps course_fee onto the fee the context reads', () => {
    const loader = codeOf('lib/chatbot/programme.ts')
    assert.match(loader, /feeInPerson: num\(r\.course_fee\)/,
      'the in-person fee no longer comes from course_fee')
    assert.match(loader, /feeOnline: num\(r\.course_fee_online\)/)
    assert.match(loader, /registrationFee: num\(r\.registration_fee\)/)
  })

  test('a missing fee is stated as missing, never as a number', () => {
    for (const value of [null, undefined, '', 'abc', NaN]) {
      const p = programme({ feeInPerson: (value as never) })
      const text = describeProgramme(p, capabilityOf(p, null))
      assert.match(text, /Fee: NOT RECORDED/, `a fee of ${String(value)} was not treated as missing`)
      assert.ok(!/GHS/.test(text), `a currency figure appeared for a fee of ${String(value)}`)
    }
  })

  test('a fee of zero is not a fee', () => {
    /*
     * Zero is not a price a training centre charges; it is an empty field that
     * happens to be numeric. Treating it as real would have the assistant
     * announce a free programme.
     */
    const loader = codeOf('lib/chatbot/programme.ts')
    assert.match(loader, /Number\.isFinite\(n\) && n > 0/,
      'zero would be quoted as a fee')
  })

  test('a string fee normalises, because Postgres numerics arrive as strings', () => {
    assert.equal(ghs('2500'), 'GHS 2,500')
    assert.equal(ghs(2500), 'GHS 2,500')
  })

  test('a malformed fee is left out rather than quoted', () => {
    assert.equal(ghs('two thousand'), null)
    assert.equal(ghs(undefined), null)
  })
})

describe('every programme field agrees from the database to the model', () => {
  /*
   * Section 4 of the brief: DATABASE FIELD -> TYPE -> LOADER -> CONTEXT ->
   * MODEL must agree for every field, and a field that does not exist must be
   * treated as unavailable rather than guessed at.
   */
  const loader = codeOf('lib/chatbot/programme.ts')
  const types = readFileSync('types/index.ts', 'utf8')

  test('every course column the loader selects is on the Course type', () => {
    const course = types.slice(types.indexOf('export interface Course'), types.indexOf('export interface Batch'))
    const select = loader.match(/COURSE_COLUMNS\s*=\s*\n?\s*'([^']+)'/)
    assert.ok(select, 'the course column list could not be found')

    const missing = select[1].split(',').map(c => c.trim())
      .filter(c => !new RegExp(`\\b${c}\\b`).test(course))
    assert.deepEqual(missing, [],
      'these columns are selected but are not on the Course type, so this ' +
      'repository cannot confirm they exist — and a missing one fails the ' +
      'whole select:\n  ' + missing.join('\n  '))
  })

  test('every batch column the loader selects is on the Batch type', () => {
    const batch = types.slice(types.indexOf('export interface Batch'))
    const select = loader.match(/from\('batches'\)\s*\n?\s*\.select\('([^']+)'\)/)
    assert.ok(select, 'the batch column list could not be found')

    const missing = select[1].split(',').map(c => c.trim())
      .filter(c => !new RegExp(`\\b${c}\\b`).test(batch.slice(0, 900)))
    assert.deepEqual(missing, [],
      'these batch columns are not on the Batch type:\n  ' + missing.join('\n  '))
  })

  test('a schema that differs costs detail, not every fact', () => {
    assert.match(loader, /COURSE_MINIMAL/)
    assert.match(loader, /full read refused/,
      'a refused read is silent instead of saying fees are now unavailable')
  })
})

describe('no outbound message poses as the marketer', () => {
  /*
   * Two survived the rebuild, in files the chatbot work never touched — and
   * both were FIRST messages, which is the worst place for it:
   *
   *   lib/leadWelcome      "Hi Ama, this is Ruth from Cambridge..."
   *                        sent before the assistant's own opening, because
   *                        autoAssign returns early when the pack sends.
   *   WA.leadAssigned      "Hi Ama, I'm Ruth from Cambridge..."
   *                        sent on every manual assignment.
   */
  test('the welcome pack says what it is', () => {
    const welcome = codeOf('lib/leadWelcome.ts')
    assert.match(welcome, /virtual assistant/,
      'the first message a lead receives does not say what is writing it')
    assert.ok(!/this is \$\{mName\}/.test(welcome),
      'the welcome pack poses as the marketer again')
  })

  test('the assignment message says what it is', () => {
    const wa = codeOf('lib/integrations/whatsapp.ts')
    const template = wa.slice(wa.indexOf('leadAssigned:'), wa.indexOf('applicationConfirmed:'))
    assert.match(template, /virtual assistant supporting/)
    assert.ok(!/I'm \$\{m\}/.test(template), 'the assignment message poses as the marketer again')
    assert.ok(!/marketerIntro/.test(template),
      'the marketer’s own intro line is being sent in their name again')
  })

  test('the welcome pack records what it sent', () => {
    /*
     * It sends the brochure. Without recording that, lib/chatbot/events would
     * not know, and the assistant would go on offering a brochure the lead
     * already has.
     */
    const welcome = codeOf('lib/leadWelcome.ts')
    assert.match(welcome, /recordEvent\(\{ leadId: opts\.leadId, event: 'BROCHURE_SENT'/)
    assert.match(welcome, /event: 'CHAT_STARTED'/)
  })
})

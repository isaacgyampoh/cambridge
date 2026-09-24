import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * THE QUESTION A STUDENT ACTUALLY ASKS: WHEN IS MY NEXT CLASS?
 *
 * The dashboard answered what they owe, which classes they are on and their
 * invoices, and not this.
 *
 * The obvious implementation would be to add class_sessions to the tables a
 * student may read and query it from the page. That would be a security bug:
 * /api/data scopes rows by an owner column and class_sessions has none for a
 * student, so they would read EVERY batch's sessions — including class_code,
 * which is the code the attendance sign-in accepts.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

const route = codeOf('app/api/student/next-class/route.ts')
const page = codeOf('app/(portal)/student/page.tsx')
const policy = codeOf('lib/data/policy.ts')

describe('the sign-in code never reaches a student', () => {
  test('class_sessions is still not a table a student may read', () => {
    const line = policy.split('\n').find(l => l.trim().startsWith('student:')) || ''
    assert.ok(!/class_sessions/.test(line),
      'a student reading class_sessions would see every batch’s class_code')
  })

  test('the route selects only the date from it', () => {
    assert.match(route, /from\('class_sessions'\)\s*\n?\s*\.select\('batch_id, session_date'\)/)
    assert.ok(!/class_code|signin_open|total_signed_in/.test(route))
  })

  test('nothing about the code reaches the page', () => {
    assert.ok(!/class_code/.test(page))
  })
})

describe('a student only ever sees their own classes', () => {
  test('the batches come from their own enrolment rows', () => {
    assert.match(route, /from\('batch_students'\)[\s\S]{0,80}\.eq\('student_id', s\.userId as string\)/)
  })

  test('every later query is restricted to those batches', () => {
    assert.match(route, /\.in\('id', batchIds\)/)
    assert.match(route, /\.in\('batch_id', batchIds\)/)
  })

  test('no batch identifier is taken from the request', () => {
    assert.ok(!/searchParams|req\.json\(\)/.test(route))
  })

  test('it requires a signed-in session', () => {
    assert.match(route, /if \(!s\.valid\) return NextResponse\.json/)
  })
})

describe('the answer is the truthful one', () => {
  test('a scheduled session is preferred, earliest first', () => {
    assert.match(route, /\.gte\('session_date', today\)/)
    assert.match(route, /\.order\('session_date', \{ ascending: true \}\)/)
  })

  test('a future start date is the fallback', () => {
    assert.match(route, /basis: 'start'/)
    assert.match(route, /String\(b\.start_date\) >= today/)
  })

  test('a start date in the past is not dressed up as a next class', () => {
    // filter keeps only dates on or after today
    assert.ok(!/start_date.*<=.*today/.test(route))
    assert.match(route, /reason: 'nothing_scheduled'/)
  })

  test('not being enrolled is its own answer', () => {
    assert.match(route, /reason: 'not_enrolled'/)
  })
})

describe('a failed read is never shown as "no class"', () => {
  test('each read is checked', () => {
    for (const v of ['mineError', 'batchError', 'sessionError']) {
      assert.match(route, new RegExp(`if \\(${v}\\) return unavailable\\(`), `${v} is discarded`)
    }
  })

  test('the page says so rather than showing an empty timetable', () => {
    assert.match(page, /nextState === 'error'/)
    assert.match(page, /could not load your timetable/)
  })

  test('and distinguishes loading from nothing scheduled', () => {
    assert.match(page, /nextState === 'loading'/)
    assert.match(page, /No class is scheduled yet/)
  })
})

describe('it is usable on a phone', () => {
  test('the join and venue controls clear the touch floor', () => {
    const block = page.slice(page.indexOf('Your next class'))
    assert.ok((block.match(/min-h-\[44px\]/g) || []).length >= 2)
  })

  test('the date is written in Accra time', () => {
    assert.match(page, /timeZone: 'Africa\/Accra'/)
  })

  test('an online class offers the link, a physical one the venue', () => {
    assert.match(page, /nextClass\.zoomLink &&/)
    assert.match(page, /nextClass\.venue &&/)
  })
})

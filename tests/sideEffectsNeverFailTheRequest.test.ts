import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Work that is already committed must not be reported as failed.
 *
 * Each of these sites had a Promise.all over a fan-out of notifications, which
 * rejects on the first failure. The behaviour of the replacement is tested in
 * quiet.test.ts; what these pin is that the sites still USE it, because the
 * regression is a one-word edit back to Promise.all.
 */

function code(path: string) {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('an admission is never reported as failed once it is committed', () => {
  const s = code('app/api/admissions/route.ts')

  test('notifications go out through runQuietly', () => {
    assert.match(s, /runQuietly\(/, 'the fan-out must not be able to reject')
  })

  test('no Promise.all over the notification fan-out', () => {
    // The shape that caused it: one unreachable number threw away every other
    // send and 500'd a request whose row was already in the database.
    assert.doesNotMatch(s, /Promise\.all\(\s*\[[\s\S]{0,200}?smsTasks/,
      'Promise.all over the SMS tasks is the bug')
    assert.doesNotMatch(s, /await Promise\.all\(/,
      'nothing in this route may reject the request after the insert')
  })

  test('the insert happens before the notifications, and nothing between them returns', () => {
    const insert = s.indexOf("from('admissions').insert")
    const notify = s.indexOf('runQuietly(')
    assert.ok(insert !== -1 && notify !== -1)
    assert.ok(insert < notify, 'the row is committed first')

    // Between the two, the only early return may be the insert's own failure.
    const between = s.slice(insert, notify)
    const returns = between.match(/return \w/g) || []
    assert.ok(returns.length <= 2,
      `unexpected early returns between committing and notifying: ${returns.length}`)
  })

  test('nobody on duty is a warning, not an empty insert', () => {
    assert.match(s, /notifications\.length > 0/,
      'an empty notification insert should be skipped and reported')
  })
})

describe('one broken WhatsApp line does not blank the status page', () => {
  test('reading a response body cannot reject out of call()', () => {
    const s = code('lib/whatsapp/wasender.ts')
    // res.text() used to sit outside the try, so a truncated stream rejected
    // sessionStatus, and the page checks every line in one Promise.all.
    const guarded = /try\s*\{\s*\n?\s*raw = await res\.text\(\)\s*\n?\s*\}\s*catch/
    assert.match(s, guarded, 'res.text() must be inside a try')
  })

  test('a failed status write does not cost the operator the page', () => {
    const s = code('app/api/whatsapp/status/route.ts')
    assert.match(s, /runQuietly\(/, 'recording status is bookkeeping, not the answer')
    assert.doesNotMatch(s, /await Promise\.all\(\(lines \|\| \[\]\)\.map\(\(l, i\) => recordLineStatus/,
      'Promise.all here means one failed write returns a 500 instead of the statuses')
  })
})

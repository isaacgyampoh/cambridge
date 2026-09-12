import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * A DATABASE FAILURE IS NEVER REPORTED AS A DECISION.
 *
 * ── THE PATTERN ────────────────────────────────────────────────────────────
 *
 * Fifty-seven places in this application read a row and then refuse on it:
 *
 *     const { data: row } = await sb.from('…').maybeSingle()
 *     if (!row) return NextResponse.json({ error: '…' }, { status: 400 })
 *
 * The error is discarded, so `row` is null for two different reasons and both
 * produce the same refusal — and every one of those refusals is phrased as a
 * fact about the caller:
 *
 *     "That programme is not open for registration."
 *     "Your sign-in has expired. Please start again."
 *     "No enrolment found."
 *     "Payment not found or already handled."
 *     "This link may be invalid or expired."
 *
 * During an outage each of those is false, and none can be acted on. The
 * sign-in one is the worst: starting again hits the same failure, so it is a
 * loop the person cannot leave, described as their fault, at the moment they
 * are trying to get in.
 *
 * These tests cover the paths where being wrongly refused costs somebody
 * money, access, or their way into the product.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the helper keeps the two outcomes apart', () => {
  const src = codeOf('lib/db/lookup.ts')

  test('it reports a failure separately from an absence', () => {
    assert.match(src, /failed: error\.message/)
    assert.match(src, /row: \(data \?\? null\)/)
  })

  test('a thrown query is a failure, not an empty result', () => {
    // The client could not reach the database at all.
    assert.match(src, /catch \(e\) \{[\s\S]{0,120}failed: e instanceof Error/)
  })

  test('the answer is 503, because repeating the request is the right move', () => {
    assert.match(src, /status: 503/)
    assert.ok(!/status: 40[0-9]/.test(src),
      'a read failure is not a client error and must not be reported as one')
  })

  test('and the reason is logged rather than shown', () => {
    assert.match(src, /console\.error\(`\$\{where\} read failed:`/)
    assert.ok(!/\$\{reason\}/.test(src.slice(src.indexOf('NextResponse.json'))),
      'the database message is being shown to the person')
  })
})

describe('nobody is locked out by a failed read', () => {
  /*
   * Authentication is the sharpest case: the refusal sends them back to a
   * screen that will fail for the same reason.
   */
  for (const [file, what] of [
    ['app/api/auth/verify-otp/route.ts', 'the sign-in code step'],
    ['app/api/auth/change-pin/route.ts', 'changing a PIN'],
  ] as const) {
    test(`${what} distinguishes a failure from an expired session`, () => {
      const src = codeOf(file)
      assert.match(src, /const \{ row: profile, failed \} = await lookup\(/,
        'the profile read discards its error again')
      assert.match(src, /if \(failed\) return unavailable\(/)
      // And the real refusal must still be there for the real case.
      assert.match(src, /if \(!profile\) return NextResponse\.json/)
    })
  }
})

describe('a paying student is not told they do not belong', () => {
  test('the portal does not sign them out over a failed read', () => {
    const src = codeOf('app/api/student/me/route.ts')
    assert.match(src, /if \(failed\) return unavailable\('\[student\/me\]'/,
      'a database blip still returns 401 and signs the student out')
  })

  test('course materials say what actually went wrong', () => {
    const src = codeOf('app/portal/material/[id]/route.ts')
    assert.match(src, /docFailed/)
    assert.match(src, /feeFailed/)
    assert.match(src, /could not check your enrolment/i,
      '"No enrolment found" is still shown to somebody who has paid for one')
    // The gate must still fail closed: no material on an unreadable record.
    assert.ok(!/if \(feeFailed\)[\s\S]{0,200}file_url/.test(src),
      'a failed fee read releases the file')
  })

  test('a graduate is not told their certificate link is invalid', () => {
    const src = codeOf('app/certificate/[token]/page.tsx')
    assert.match(src, /if \(failed\) \{/)
    assert.match(src, /could not load your certificate/i)
  })
})

describe('money is never applied against a record that could not be read', () => {
  const src = codeOf('app/api/classes/verify-payment/route.ts')

  test('a failed payment read is not "already handled"', () => {
    assert.match(src, /if \(payFailed\) return unavailable\(/,
      'an accountant is still told a pending payment was already handled')
  })

  test('and a failed enrolment read stops before applying anything', () => {
    /*
     * Leaving the payment pending is the safe direction: it can be verified
     * again. Applying it against an unread enrolment could not be undone.
     */
    const apply = src.indexOf('const newPaid')
    const guard = src.indexOf('if (enrFailed)')
    assert.ok(guard > 0 && guard < apply,
      'the amount is applied before the enrolment read is checked')
  })
})

describe('the course flow stays fixed', () => {
  test('registration does not call an outage a closed programme', () => {
    const src = codeOf('app/api/applications/submit/route.ts')
    assert.match(src, /if \(courseErr\)/)
    assert.match(src, /status: 503/)
  })

  test('the public programme list does not call an outage an empty centre', () => {
    const src = codeOf('app/api/courses/public/route.ts')
    assert.match(src, /if \(error\)/)
    assert.match(src, /status: 503/)
  })
})

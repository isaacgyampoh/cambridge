import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

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

/**
 * ─── THE CLASS IS CLOSED ────────────────────────────────────────────────────
 *
 * The tests above name individual paths. This one is the rule itself: nowhere
 * in the application may a row be read with its error discarded and the null
 * result then used to refuse somebody.
 *
 * It matters that this is a scan rather than a list. The fifty-seven sites
 * were not written by someone ignoring a rule — they were written one at a
 * time, each looking exactly like the last one, over months. A list of known
 * offenders would have been finished and then quietly refilled. A count that
 * must stay at zero fails the moment the fifty-eighth is written.
 */
describe('no read refuses on an error it discarded', () => {
  /** `const { data: x } = await sb.from('t')…` */
  const READ = /const \{\s*data(?::\s*(\w+))?\s*\}\s*=\s*await sb\s*\.?\s*\n?\s*\.?from\('(\w+)'\)/g

  /** Language that turns a null row into a statement about the caller. */
  const REFUSAL = new RegExp(
    [
      'return NextResponse\\.json\\(\\s*\\{\\s*error',
      'status:\\s*(?:400|401|403|404|409)',
      'not (?:open|found|allowed|eligible|active|available|permitted)',
      'unauth', 'forbidden', 'cannot', 'denied',
    ].join('|'),
    'i',
  )

  test('every refusal that follows a read has checked whether the read worked', () => {
    const offenders: string[] = []

    for (const file of [...sourceFiles('app'), ...sourceFiles('lib')]) {
      const src = codeOf(file)
      const lines = src.split('\n')

      for (const m of src.matchAll(READ)) {
        const name = m[1] || 'data'
        const at = src.slice(0, m.index).split('\n').length - 1
        // The refusal, if there is one, sits within a few lines of the read.
        const window = lines.slice(at, at + 8).join('\n')

        const nullCheck = new RegExp(`if \\(\\s*!\\s*${name}\\b`)
        if (nullCheck.test(window) && REFUSAL.test(window)) {
          offenders.push(`${file}:${at + 1} — reads '${m[2]}' into '${name}', refuses on null, never checked the error`)
        }
      }
    }

    assert.deepEqual(
      offenders, [],
      `A failed read is being reported to somebody as their problem:\n  ${offenders.join('\n  ')}\n\n` +
      'Use lookup() from lib/db/lookup.ts and answer a failure with unavailable().',
    )
  })
})

/**
 * ─── AND THE OTHER HALF OF IT ───────────────────────────────────────────────
 *
 * A refusal is the visible failure. The quiet one is a read that guards
 * against doing something twice: those are written `if (x) return` or
 * `if (!x) { …do it… }`, so a failed read does not refuse anybody — it lets
 * the thing happen a second time, and nothing anywhere says so.
 *
 * Registration has three of these in a row, and they are the ones that cost
 * real money and real trust:
 *
 *   - the marketer_enrollments check, which is all that stops a second lot of
 *     points and a second GHS 200 for one registration;
 *   - the admissions check, which is all that stops a second admission number
 *     and a duplicate admission letter to the student;
 *   - the lead lookup, which is all that stops a duplicate student record
 *     whose history and marketer live on the first one.
 */
describe('registration cannot do the same thing twice', () => {
  const src = codeOf('lib/registration/complete.ts')

  test('the remuneration guard stops on a failed read', () => {
    assert.match(src, /const \{ row: already, failed: alreadyFailed \} = await lookup\(/)
    assert.match(src, /if \(alreadyFailed\) return retryable\(/,
      'A failed read here pays a marketer twice for one student.')
  })

  test('the admission guard stops on a failed read', () => {
    assert.match(src, /const \{ row: existingAdm, failed: admFailed \} = await lookup\(/)
    assert.match(src, /if \(admFailed\) return retryable\(/,
      'A failed read here mints a second admission number and sends a second letter.')
  })

  test('the lead lookups stop on a failed read', () => {
    assert.match(src, /if \(failed\) return retryable\('lead by phone'/)
    assert.match(src, /if \(failed\) return retryable\('lead by email'/)
  })

  test('stopping releases the claim, so a retry can finish the registration', () => {
    /*
     * Without this the fix would be worse than the bug. The claim in
     * message_jobs means "already completed"; bailing out while it stands
     * makes every retry — the webhook's and the student's reload — return
     * alreadyProcessed, and the admission, letter and fee ledger are never
     * created for a registration that was paid for.
     */
    assert.match(src, /from\('message_jobs'\)\.delete\(\)/,
      'retryable() must give the claim back.')
    assert.match(src, /\.eq\('dedupe_key', `app_complete:\$\{applicationId\}`\)/)
  })

  test('the answer given to the caller is one they can act on', () => {
    const fn = src.slice(src.indexOf('const retryable'))
    assert.match(fn.slice(0, 600), /Please try again in a moment/)
    assert.ok(!/not found/i.test(fn.slice(0, 600)),
      'A failed read must not be reported as a missing application.')
  })
})

/**
 * The same fail-open shape, found in two more places while closing the class.
 * Neither refuses anybody, and both are silent when they go wrong.
 */
describe('uniqueness and duplicate checks fail closed', () => {
  test('a referral code is never taken on the strength of a failed read', () => {
    /*
     * `if (!clash) { code = candidate; break }` — a failed read reads as
     * "nobody has this code". Two marketers then share one referral code, and
     * every lead arriving on it is credited to whichever row is found first.
     */
    const src = codeOf('app/api/marketer/ensure-code/route.ts')
    assert.match(src, /const \{ row: clash, failed: clashFailed \} = await lookup\(/)
    assert.match(src, /if \(clashFailed\) return unavailable\(/)
  })

  test('a second voucher is not requested on the strength of a failed read', () => {
    const src = codeOf('app/api/prep/voucher/route.ts')
    assert.match(src, /const \{ row: openReq, failed: openFailed \} = await lookup\(/)
    assert.match(src, /if \(openFailed\) return unavailable\(/)
  })

  test("a failed attendance read neither denies a clock-out nor overwrites a clock-in", () => {
    const src = codeOf('app/api/staff-attendance/route.ts')
    assert.match(src, /if \(existingFailed\) return unavailable\(/)
    // The check must come before both branches, not inside one of them.
    const guard = src.indexOf('existingFailed) return unavailable')
    const out = src.indexOf("action === 'out'")
    assert.ok(guard > 0 && guard < out, 'The guard must precede the clock-out branch.')
  })
})

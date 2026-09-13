import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A VALUE MUST NOT BE ABLE TO BECOME A FILTER.
 *
 * ── THE SHAPE OF THIS BUG ──────────────────────────────────────────────────
 *
 * `.eq(col, value)` and `.in(col, values)` hand their arguments to the client
 * as values, and the client encodes them. `.or(string)` does not: the whole
 * string is PostgREST filter syntax, so any user text interpolated into it is
 * parsed as syntax too. A comma starts a new condition and a bracket closes a
 * group.
 *
 * It has happened twice in this codebase, and both times the damage was the
 * kind nobody would notice:
 *
 *   STAFF MESSAGES — the thread query interpolated the other person's id.
 *
 *       with=00000000-0000-0000-0000-000000000000),or(id.not.is.null
 *
 *   closed the `and(` early and added an always-true term, turning "the
 *   thread between these two people" into "the two hundred most recent staff
 *   messages". Any signed-in member of staff could read everybody's private
 *   messages, including the ones about them.
 *
 *   LEAD INTAKE — the duplicate check interpolated the email address, which
 *   arrives in the body of a PUBLIC webhook. An address of
 *   `x@y.com,assigned_to.not.is.null` matched the first assigned lead of the
 *   last sixty days, so the real lead was never created — it was reported as
 *   a duplicate — and the caller was handed an unrelated lead's database id.
 *   Anyone able to post to a webhook could make enquiries disappear.
 *
 * ── WHY THIS IS A SCAN AND NOT A NOTE ──────────────────────────────────────
 *
 * Neither was written by somebody being careless. `.or()` takes a string, and
 * building a string from the values you have is the obvious thing to do — it
 * reads correctly, and it works perfectly until somebody sends a comma. The
 * third one will look just as reasonable as the first two.
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

/**
 * The one place allowed to interpolate into `.or()`, and the reason.
 *
 * staff_messages genuinely needs a two-sided OR that `.eq`/`.in` cannot
 * express: `.in('sender_id', [a,b]).in('recipient_id', [a,b])` would also
 * match the OTHER person's messages to themselves, which is the leak it is
 * trying to prevent.
 *
 * It is safe because both ids are validated as UUIDs before they reach the
 * string — hex and dashes cannot carry syntax. The validation is the fix; the
 * shape of the query is not. So the exception is pinned to the file AND to
 * the guard, and if the guard goes the test fails with it.
 */
const ALLOWED = new Map<string, RegExp>([
  ['app/api/messages/route.ts', /z\.string\(\)\.uuid\(\)\.safeParse\(withUser\)/],
])

describe('no user value is interpolated into a PostgREST filter string', () => {
  test('.or() is never built from a template literal, except where proven safe', () => {
    const offenders: string[] = []

    for (const file of [...sourceFiles('app'), ...sourceFiles('lib')]) {
      const src = codeOf(file)
      const rel = file.replace(/^.*?cambridge\//, '')

      // `.or(`…${…}…`)` — a template literal carrying an interpolation.
      for (const m of src.matchAll(/\.or\(\s*`([^`]*)`/g)) {
        if (!m[1].includes('${')) continue

        const exception = ALLOWED.get(rel)
        if (!exception) {
          const line = src.slice(0, m.index).split('\n').length
          offenders.push(`${rel}:${line} — interpolates into .or(); a comma or bracket in that value becomes filter syntax`)
          continue
        }
        assert.match(
          src, exception,
          `${rel} is allowed to interpolate into .or() only because it validates its ids first. That guard is gone.`,
        )
      }
    }

    assert.deepEqual(
      offenders, [],
      `A value can become a filter here:\n  ${offenders.join('\n  ')}\n\n` +
      'Use separate .eq()/.in() calls, which pass values as values. If the query genuinely ' +
      'needs a two-sided OR, validate every interpolated id as a UUID first and add it to ALLOWED.',
    )
  })

  test('lead intake de-duplicates with values, not with a filter string', () => {
    /*
     * The specific regression that matters most, because the input is public
     * and the failure is silent: a suppressed lead looks exactly like a
     * duplicate, and nobody is waiting for an enquiry they never heard about.
     */
    const src = codeOf('lib/leadIntake.ts')
    assert.ok(!/\.or\(/.test(src), 'leadIntake must not build a filter string at all.')
    assert.match(src, /\.in\('phone', variants\)/,
      'The phone side matches every stored spelling, as values.')
    assert.match(src, /\.eq\('email', email\)/,
      'The email side passes the address as a value, so a comma in it is just a comma.')
  })

  test('and it fails closed, so a blip cannot create a duplicate person', () => {
    const src = codeOf('lib/leadIntake.ts')
    assert.match(src, /duplicate check by phone failed/)
    assert.match(src, /duplicate check by email failed/)
  })
})

describe('the phone spelling is one implementation', () => {
  test('lead intake uses the canonical normaliser rather than its own', () => {
    /*
     * It had a private copy that disagreed on exactly the inputs that matter.
     * Given "00233201234567" it saw a leading zero, replaced it, and stored
     * `2330233201234567` — unreachable, and matching no dedupe variant ever
     * again, so that person returned as a new lead every time they enquired.
     */
    const src = codeOf('lib/leadIntake.ts')
    assert.match(src, /import \{[^}]*canonicalPhone[^}]*\} from '@\/lib\/leads\/importValidation'/)
    assert.match(src, /return canonicalPhone\(p\)/)
  })
})

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * THE CORRECT SECRET MUST NOT BE REJECTED BY THE LINK THAT CARRIES IT.
 *
 * ── THE LIVE FAULT ─────────────────────────────────────────────────────────
 *
 * /setup/unlock?key=… returned "Not authorised" in production with the real
 * secret. The endpoint was reachable, SETUP_SECRET was configured (the POST
 * route reported setupSecretConfigured: true), and the value was right.
 *
 * The validator's own header comment had predicted it:
 *
 *     +   becomes a space
 *     &   truncates the parameter
 *     %   is read as the start of an escape and mangles what follows
 *
 * That was written as a reason to PREFER the Authorization header — and then
 * /setup/unlock was built specifically for browser ?key= delivery, because
 * somebody locked out of their own portal cannot send a header from a phone.
 * It inherited the flaw, and the symptom was exactly the one predicted:
 * refused every time, with no indication why.
 *
 * ── WHAT IS ASSERTED HERE ──────────────────────────────────────────────────
 *
 * The parsing, against the real query strings a browser produces. The secret
 * itself is never in this file, never in the repository, and never in a
 * response — the values below are obviously-fake stand-ins chosen to contain
 * the characters that break.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const guard = codeOf('lib/auth/guard.ts')
const unlock = codeOf('app/setup/unlock/route.ts')

/**
 * The readings the validator now tries, reproduced exactly.
 *
 * Reimplemented rather than imported because lib/auth/guard.ts pulls in
 * server-only configuration that the test runner cannot resolve. The test
 * below asserts the shipped code contains the same branches, so this cannot
 * drift silently into testing a fiction.
 */
function rawCandidates(rawQuery: string, param: string): string[] {
  const marker = `${param}=`
  const at = rawQuery.startsWith(marker)
    ? 0
    : rawQuery.indexOf(`&${marker}`) >= 0
      ? rawQuery.indexOf(`&${marker}`) + 1
      : -1
  if (at < 0) return []

  const afterName = rawQuery.slice(at + marker.length)
  const upToNextParam = afterName.split('&')[0]

  const out = new Set<string>([afterName, upToNextParam])
  for (const value of [afterName, upToNextParam]) {
    try { out.add(decodeURIComponent(value)) } catch { /* bare % */ }
  }
  return [...out]
}

/** Every reading of `?key=…`, as the validator assembles them. */
function readings(url: string): string[] {
  const parsed = new URL(url)
  const rawQuery = parsed.search.startsWith('?') ? parsed.search.slice(1) : parsed.search
  return [
    parsed.searchParams.get('key') ?? '',
    parsed.searchParams.get('secret') ?? '',
    ...rawCandidates(rawQuery, 'key'),
    ...rawCandidates(rawQuery, 'secret'),
  ].map(v => v.trim()).filter(Boolean)
}

const BASE = 'https://portal.cambridge.edu.gh/setup/unlock'

describe('a secret survives the characters a URL alters', () => {
  test('a "+" pasted verbatim is still recognised', () => {
    /*
     * The classic. URLSearchParams reads '+' as a space, per the
     * form-encoding rule, so a base64 secret arrives mangled and matches
     * nothing.
     */
    const secret = 'aB3+xY9zQw=='
    const found = readings(`${BASE}?key=${secret}`)
    assert.ok(found.includes(secret), `no reading recovered "${secret}" — got ${JSON.stringify(found)}`)
  })

  test('and so is a properly percent-encoded one', () => {
    // Somebody who encoded it correctly must keep working.
    const secret = 'aB3+xY9zQw=='
    assert.ok(readings(`${BASE}?key=aB3%2BxY9zQw%3D%3D`).includes(secret))
  })

  test('an "&" no longer truncates it', () => {
    // Without the to-end-of-query reading, everything after & was lost.
    const secret = 'left&right'
    assert.ok(readings(`${BASE}?key=${secret}`).includes(secret))
  })

  test('a bare "%" does not discard the value', () => {
    // decodeURIComponent throws on this; the undecoded form must survive.
    const secret = '50%off'
    assert.ok(readings(`${BASE}?key=${secret}`).includes(secret))
  })

  test('an ordinary secret still works', () => {
    const secret = 'plainSecretValue123'
    assert.ok(readings(`${BASE}?key=${secret}`).includes(secret))
  })

  test('trailing whitespace from a copy-paste is trimmed', () => {
    assert.ok(readings(`${BASE}?key=abc%20`).includes('abc'))
  })
})

describe('and nothing else gets in', () => {
  test('a wrong value produces no reading equal to the secret', () => {
    /*
     * The point of the fix: more readings of the SAME input, not acceptance
     * of different inputs. Every candidate is still compared against the real
     * secret, so a value that is not it matches none of them.
     */
    const real = 'aB3+xY9zQw=='
    for (const wrong of ['aB3+xY9zQw=', 'AB3+XY9ZQW==', 'wrong', 'aB3 xY9zQw==', '']) {
      const found = readings(`${BASE}?key=${encodeURIComponent(wrong)}`)
      assert.ok(!found.includes(real), `"${wrong}" produced a reading equal to the secret`)
    }
  })

  test('an empty or absent key yields no candidate at all', () => {
    assert.deepEqual(readings(`${BASE}`), [])
    assert.deepEqual(readings(`${BASE}?key=`), [])
    assert.deepEqual(readings(`${BASE}?other=x`), [])
  })

  test('a key belonging to another parameter is not harvested', () => {
    // `monkey=` must not be read as `key=`.
    assert.ok(!readings(`${BASE}?monkey=abc`).includes('abc'))
  })
})

describe('one validator, used by both routes', () => {
  test('the browser link and the POST share it', () => {
    assert.match(unlock, /describeSetupAuth\(req\)/)
    assert.match(codeOf('app/api/setup/open/route.ts'), /describeSetupAuth\(req\)/)
  })

  test('neither implements its own comparison', () => {
    for (const [name, src] of [['unlock', unlock], ['open', codeOf('app/api/setup/open/route.ts')]] as const) {
      /*
       * `SECRETS.setupSecret` is the READ. `setupSecretConfigured` is a field
       * name in the POST route's response — a boolean about configuration,
       * not a secret — so the check has to be about the read specifically.
       */
      assert.ok(!/timingSafeEqual|SECRETS\.setupSecret|process\.env\.SETUP_SECRET/.test(src),
        `${name} reads or compares the secret itself instead of delegating.`)
    }
  })

  test('the shipped validator contains the readings this test reproduces', () => {
    // So the reimplementation above cannot drift into testing a fiction.
    assert.match(guard, /function rawCandidates\(rawQuery: string, param: string\)/)
    assert.match(guard, /const upToNextParam = afterName\.split\('&'\)\[0\]/)
    assert.match(guard, /decodeURIComponent\(value\)/)
  })

  test('comparison is still constant time, and length-guarded', () => {
    assert.match(guard, /timingSafeEqual\(ab, bb\)/)
    assert.match(guard, /if \(ab\.length !== bb\.length\) return false/)
  })

  test('every candidate is checked even after one matches', () => {
    // So the work done does not depend on WHICH reading was correct.
    assert.match(guard, /if \(safeEqual\(trimmed, expected\)\) ok = true/)
    assert.ok(!/return \{ ok: true/.test(guard.slice(guard.indexOf('for (const candidate'))),
      'An early return would leak which reading matched.')
  })
})

describe('nothing about the secret escapes', () => {
  test('the refusal describes the request, never the secret', () => {
    const hint = unlock.slice(unlock.indexOf('function unlockHint'))
    assert.ok(!/expected|SECRETS|setupSecret|lengthMatch/.test(hint),
      'The hint must be derived only from the caller’s own input.')
  })

  test('the hint names the characters that break, not the value', () => {
    assert.match(unlock, /Authorization: Bearer header/)
    assert.match(unlock, /never sent to the server at all/,
      'A "#" cannot be recovered server-side and must be called out.')
  })

  test('no log line can emit the secret', () => {
    const logs = guard.split('\n').filter(l => /console\./.test(l))
    for (const line of logs) {
      assert.ok(!/expected|supplied|candidate/.test(line), `a log may print a secret: ${line.trim()}`)
    }
    const unlockLogs = unlock.split('\n').filter(l => /console\./.test(l))
    for (const line of unlockLogs) {
      assert.ok(!/key|secret|supplied/i.test(line.replace(/setup\/unlock|secretConfigured/g, '')),
        `a log may print a secret: ${line.trim()}`)
    }
  })

  test('and the response never carries it', () => {
    const responses = unlock.match(/NextResponse\.json\([\s\S]*?\)/g) || []
    for (const r of responses) {
      assert.ok(!/supplied|expected|attempt\.lengthMatch/.test(r), `a response may carry a secret: ${r}`)
    }
  })
})

describe('the security properties are unchanged', () => {
  test('unlock only opens a window', () => {
    assert.match(unlock, /openProvisioningWindow\(true\)/)
    assert.ok(!/provisionSuperAdmin/.test(unlock))
  })

  test('it is rate limited and audited', () => {
    assert.match(unlock, /rateLimit\(`setup-open:/)
    assert.match(unlock, /setup\.window_denied/)
    assert.match(unlock, /setup\.window_opened/)
  })

  test('and the redirect strips the key from the address bar', () => {
    assert.match(unlock, /NextResponse\.redirect\(new URL\('\/setup', req\.url\), 303\)/)
  })
})

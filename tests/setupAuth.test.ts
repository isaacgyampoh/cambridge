import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * SETUP / PROVISIONING AUTHORISATION.
 *
 * ── WHY PROVISIONING KEPT FAILING ──────────────────────────────────────────
 *
 * /api/auth/first-run returned "Not authorised." for a correct secret.
 *
 * It compared the secret itself and read only `?secret=` from the query
 * string, while lib/auth/guard.ts already had a helper accepting three
 * locations. The query string is the one that mangles the value: it is
 * URL-decoded before the server sees it, and three characters that appear
 * routinely in generated secrets do not survive the trip.
 *
 *     '+'  becomes a space
 *     '&'  truncates the parameter
 *     '%'  starts an escape sequence and mangles what follows
 *
 * A base64 secret containing '+' could therefore never authenticate, and the
 * bare "Not authorised." gave no way to tell that from a wrong secret.
 *
 * These pin the decoding behaviour that caused it, and the contract that fixes
 * it. They do not use, print or derive any real secret.
 */

describe('a query string mangles characters that appear in real secrets', () => {
  const read = (raw: string) =>
    new URL(`https://x/api/auth/first-run?secret=${raw}`).searchParams.get('secret')

  test("'+' is decoded to a space, so a base64 secret cannot match", () => {
    assert.equal(read('ab+cd'), 'ab cd')
  })

  test("'&' truncates the value", () => {
    assert.equal(read('ab&cd'), 'ab')
  })

  test('an alphanumeric secret survives, which is why this went unnoticed', () => {
    assert.equal(read('abc123XYZ'), 'abc123XYZ')
  })

  test('a header is not URL-decoded, so it carries any secret intact', () => {
    for (const secret of ['ab+cd', 'ab&cd', 'ab%cd', 'a/b+c=']) {
      const header = `Bearer ${secret}`
      assert.equal(header.replace(/^Bearer\s+/i, ''), secret,
        'the header round-trip altered the value')
    }
  })
})

describe('the provisioning route uses the shared guard', () => {
  const ROUTE = readFileSync('app/api/auth/first-run/route.ts', 'utf8')
  const GUARD = readFileSync('lib/auth/guard.ts', 'utf8')

  test('first-run no longer compares the secret itself', () => {
    assert.ok(!/timingSafeEqual/.test(ROUTE),
      'first-run still hand-rolls the comparison instead of using the guard')
    assert.match(ROUTE, /describeSetupAuth\(req\)/)
  })

  test('the guard accepts a header as well as the query string', () => {
    assert.match(GUARD, /authorization/i)
    assert.match(GUARD, /searchParams\.get\('key'\)/)
    assert.match(GUARD, /searchParams\.get\('secret'\)/)
  })

  test('the header is preferred over the query string', () => {
    // Order matters: a caller sending both should get the unmangled one.
    const body = GUARD.slice(GUARD.indexOf('export function describeSetupAuth'))
    const headerAt = body.indexOf("req.headers.get('authorization')")
    const queryAt = body.indexOf("searchParams.get('key')")
    assert.ok(headerAt !== -1 && queryAt !== -1)
    assert.ok(headerAt < queryAt, 'the query string is read before the header')
  })

  test('both sides are trimmed, so a pasted newline does not fail the check', () => {
    const body = GUARD.slice(GUARD.indexOf('export function describeSetupAuth'))
    assert.match(body, /\.trim\(\)/)
    assert.match(body, /SECRETS\.setupSecret\.trim\(\)/)
  })

  test('a missing SETUP_SECRET is reported, not treated as a mismatch', () => {
    const body = GUARD.slice(GUARD.indexOf('export function describeSetupAuth'))
    assert.match(body, /configured: false/,
      'an unconfigured environment is indistinguishable from a wrong secret')
  })
})

describe('diagnostics disclose nothing', () => {
  const ROUTE = readFileSync('app/api/auth/first-run/route.ts', 'utf8')
  const GUARD = readFileSync('lib/auth/guard.ts', 'utf8')

  test('the secret is never logged, returned, or put in an audit record', () => {
    for (const [name, src] of [['route', ROUTE], ['guard', GUARD]] as const) {
      const lines = src.split('\n').filter(l => {
        const t = l.trim()
        return !t.startsWith('*') && !t.startsWith('//')
      })
      for (const line of lines) {
        if (!/console\.|recordAudit|NextResponse\.json/.test(line)) continue
        assert.ok(!/\bsupplied\b|\bexpected\b|setupSecret/.test(line),
          `${name} may emit the secret: ${line.trim().slice(0, 90)}`)
      }
    }
  })

  test('only safe metadata is surfaced', () => {
    // Where it was read from and whether the server is configured say nothing
    // about the value. lengthMatch is one bit and is the decisive diagnostic.
    assert.match(ROUTE, /setupSecretConfigured/)
    assert.match(ROUTE, /suppliedVia/)
  })

  test('the response tells the caller how to send an awkward secret', () => {
    assert.match(ROUTE, /Authorization: Bearer/,
      'a rejected caller is given no way to work out what went wrong')
  })
})

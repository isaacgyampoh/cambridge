import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A build must never require a production secret.
 *
 * The new deployment failed outright:
 *
 *   Error occurred prerendering page "/public-alumni"
 *   Missing required environment variable SUPABASE_SERVICE_KEY
 *   Export encountered an error ... exiting the build
 *
 * Three things rendered at build time reached for the service key:
 * /public-alumni and /api/public/stats directly, and /welcome through
 * loadProgrammes. Each one turned a missing runtime secret into a failed
 * build, and a build that needs the production key is a build nobody can run
 * on a fresh deployment, in CI, or on a new host.
 *
 * The real proof is a build with the key removed from the environment AND
 * from .env.local — these pin the three fixes that make it pass.
 */

const read = (p: string) => readFileSync(p, 'utf8')

describe('pages that read the database are rendered per request', () => {
  test('the public alumni page is dynamic', () => {
    const s = read('app/public-alumni/page.tsx')
    assert.match(s, /export const dynamic = 'force-dynamic'/)
  })

  test('the public stats route is dynamic, not statically revalidated', () => {
    const s = read('app/api/public/stats/route.ts')
    assert.match(s, /export const dynamic = 'force-dynamic'/)
    assert.doesNotMatch(s, /export const revalidate/,
      'revalidate makes it static, which runs it during the build')
  })

  test('the stats route still caches, at the edge rather than at build', () => {
    const s = read('app/api/public/stats/route.ts')
    assert.match(s, /s-maxage=3600/)
  })
})

describe('a missing database client is reported, not thrown', () => {
  const s = read('lib/chatbot/programme.ts')

  test('building the client is guarded', () => {
    /*
     * createServiceClient() throws when SUPABASE_SERVICE_KEY is absent —
     * before any query — and that exception escaped loadProgrammes and took
     * down the statically generated front page.
     */
    const at = s.indexOf('export async function loadProgrammes')
    assert.notEqual(at, -1)
    const body = s.slice(at, at + 1200)
    assert.match(body, /try\s*\{[\s\S]{0,80}?createServiceClient\(\)/,
      'the client must be built inside a try')
    assert.match(body, /return \{ ok: false, error: why \}/,
      'and a failure reported through the result, not as an exception')
  })

  test('it is the same shape the function already uses for unreadable courses', () => {
    // Callers distinguish "unreadable" from "no programmes"; a missing key is
    // the former, and must not look like a centre with no courses.
    assert.match(s, /ok: false, error:/)
    assert.doesNotMatch(s.slice(s.indexOf('export async function loadProgrammes'),
      s.indexOf('export async function loadProgrammes') + 1200),
      /return \{ ok: true, data: \[\] \}/,
      'a missing key must not read as an empty catalogue')
  })

  test('and it says so loudly', () => {
    assert.match(s, /console\.error\('\[chatbot\] no database client/)
  })
})

describe('nothing new quietly starts needing the key at build time', () => {
  function pagesUnder(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) pagesUnder(p, out)
      else if (e.name === 'page.tsx') out.push(p)
    }
    return out
  }

  test('a page that uses the service client directly is dynamic', () => {
    const offenders = pagesUnder('app')
      .filter(p => /createServiceClient/.test(read(p)))
      .filter(p => !/export const dynamic = 'force-dynamic'/.test(read(p)))
    assert.deepEqual(offenders, [],
      'these are prerendered at build time and will fail a build with no service key')
  })
})

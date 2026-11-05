import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * WHEN THE SERVER CALLS ITSELF, THE CALL HAS TO ARRIVE.
 *
 * ── WHAT WENT WRONG ────────────────────────────────────────────────────────
 *
 * A campaign sat at "sending" for days with its sent count frozen. Every part
 * of it was correct except one: `/api/info-sessions/worker` was not in the
 * middleware's list of paths that authenticate themselves, so the middleware
 * demanded a session cookie — and the server, calling itself with the cron
 * secret, has no cookie. Production answered every hop with
 *
 *     401 {"error":"Please sign in to continue."}
 *
 * before the handler that would have checked the secret ever ran. The chain
 * never advanced. The fifteen-minute recovery sweep never advanced it either,
 * because the dispatcher calls the same blocked path. Nothing in the logs said
 * so, because the hop deliberately ignores its own response.
 *
 * ── THE INVARIANT ──────────────────────────────────────────────────────────
 *
 * Any path this application calls on itself with the cron secret must be
 * exempt from the session check, because such a request cannot ever carry a
 * session. One list is the authority and the other is derived from the code,
 * so adding a scheduled task that is unreachable fails here instead of in
 * production three weeks later.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const proxy = codeOf('proxy.ts')

/** The middleware's own list, read out of the array literal it uses. */
function cronPaths(): string[] {
  const start = proxy.indexOf('const CRON_PATHS = [')
  assert.ok(start > -1, 'proxy.ts no longer has a CRON_PATHS list')
  const end = proxy.indexOf(']', start)
  return [...proxy.slice(start, end).matchAll(/'([^']+)'/g)].map(m => m[1])
}

/** The middleware's own matching rule, so this test cannot disagree with it. */
function isMatch(pathname: string, list: string[]): boolean {
  return list.some(p =>
    p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + '/'),
  )
}

function serverFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) serverFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

describe('every path the server calls on itself is reachable', () => {
  test('the middleware still exempts the paths that authenticate themselves', () => {
    const paths = cronPaths()
    assert.ok(paths.length > 5, 'the exempt list is suspiciously short')
    assert.match(proxy, /if \(isMatch\(pathname, CRON_PATHS\)\) return pass\(\)/,
      'the exempt list is no longer consulted')
  })

  test('every task the dispatcher runs can get past the session check', () => {
    /*
     * Derived from the dispatcher's own table rather than retyped. The
     * campaign worker is in that table, every fifteen minutes, and was not in
     * the exempt list — so the sweep that was meant to be the safety net was
     * refused as reliably as the chain it was there to rescue.
     */
    const tasks = codeOf('app/api/cron/run/route.ts')
    const table = tasks.slice(tasks.indexOf('const TASKS'), tasks.indexOf('\n]', tasks.indexOf('const TASKS')))
    const called = [...table.matchAll(/path:\s*'([^']+)'/g)].map(m => m[1])
    assert.ok(called.length > 10, `the dispatcher's task table was not read (${called.length} paths)`)

    const exempt = cronPaths()
    const blocked = called.filter(p => !isMatch(p, exempt))
    assert.deepEqual(blocked, [],
      'the dispatcher calls these paths with the cron secret and no cookie, and the '
      + 'middleware will answer them with "Please sign in to continue":\n  ' + blocked.join('\n  '))
  })

  test('and so can every path a handler calls on itself with that secret', () => {
    /*
     * The other half. The campaign chain is not in the dispatcher's table —
     * each hop fires the next directly — so a test that only read that table
     * would have passed while every hop was refused.
     */
    const exempt = cronPaths()
    const offenders: string[] = []

    for (const file of [...serverFiles('app'), ...serverFiles('lib')]) {
      const src = codeOf(file)
      if (!src.includes('cronSecret')) continue
      for (const m of src.matchAll(/['"`](\/api\/[A-Za-z0-9/_-]+)['"`]|\$\{publicOrigin\(\)\}(\/api\/[A-Za-z0-9/_-]+)/g)) {
        const path = m[1] || m[2]
        if (!path || isMatch(path, exempt)) continue
        offenders.push(`${file.replace(/^.*?cambridge\//, '')} — ${path}`)
      }
    }

    assert.deepEqual(offenders, [],
      'these self-calls carry the cron secret but their path is not exempt from the '
      + 'session check, so the middleware refuses them before the handler reads the '
      + 'secret:\n  ' + offenders.join('\n  '))
  })

  test('the campaign worker in particular', () => {
    // Named, because this is the one that cost a campaign.
    assert.ok(isMatch('/api/info-sessions/worker', cronPaths()),
      'the campaign worker is behind the session check again')
  })
})

describe('a refused hop is not silent', () => {
  const campaign = codeOf('lib/infoSessionCampaign.ts')
  const hop = campaign.slice(campaign.indexOf('export async function triggerNextHop'))

  test('the secret is read before the try, not inside it', () => {
    /*
     * Reading a missing CRON_SECRET throws. Inside the try that throw landed
     * in the same catch as the expected abort, so a deployment that could not
     * authenticate its own hops was indistinguishable from a healthy one.
     */
    const body = hop.slice(0, hop.indexOf('const url ='))
    assert.match(body, /secret = SECRETS\.cronSecret/)
    assert.match(body, /CRON_SECRET is not set/)
    const tryAt = hop.indexOf('const res = await fetch(')
    const readAt = hop.indexOf('secret = SECRETS.cronSecret')
    assert.ok(readAt > -1 && readAt < tryAt, 'the secret is still read inside the fetch try')
  })

  test('and a hop that is refused says so', () => {
    assert.match(hop, /const res = await fetch\(/)
    assert.match(hop, /if \(!res\.ok\)/)
    assert.match(hop, /console\.error\('\[campaign\] hop'/)
  })
})

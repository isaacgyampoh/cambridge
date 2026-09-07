import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { apiQuery, ApiQueryError } from '../lib/api/query.ts'

/**
 * A FAILED READ MUST NOT LOOK LIKE AN EMPTY TABLE.
 *
 * ── WHAT WENT WRONG ────────────────────────────────────────────────────────
 *
 * Five pages carried their own copy of this function, and every copy ended:
 *
 *     const json = await res.json()
 *     return json.data || []
 *
 * Nothing looked at res.ok. /api/data answers a failure with { error } and no
 * `data` — 401 once the session has expired, 403 when the role does not reach
 * the table, 500 when the query fails — so all three came back as an empty
 * array, indistinguishable from a table that genuinely has no rows.
 *
 * An expired session therefore did not send anyone to sign in. It drew the
 * finance report with revenue at GHS 0.00, the marketer board with every
 * officer on zero leads, and the admin report showing no leads this month.
 * Those are numbers an operator acts on, and nothing on the page suggested
 * they were not real.
 */

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function respondWith(status: number, body: unknown) {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })) as typeof fetch
}

describe('apiQuery refuses to disguise a failure as no data', () => {
  test('a 401 throws rather than returning []', async () => {
    respondWith(401, { error: 'Not signed in' })
    const err = await apiQuery('payments', '*').then(() => null, e => e)
    assert.ok(err instanceof ApiQueryError, 'an expired session returned rows instead of throwing')
    assert.equal(err.status, 401)
    assert.match(err.userMessage, /session has expired/i)
  })

  test('a 403 says the access is missing, not that the table is empty', async () => {
    respondWith(403, { error: 'Forbidden' })
    const err = await apiQuery('payments', '*').then(() => null, e => e)
    assert.ok(err instanceof ApiQueryError)
    assert.match(err.userMessage, /do not have access/i)
  })

  test('a 500 throws', async () => {
    respondWith(500, { error: 'Could not load that information. Please try again.' })
    await assert.rejects(apiQuery('leads', '*'), ApiQueryError)
  })

  test('a 200 carrying { error } is still a failure', async () => {
    // /api/data has returned 200-with-error before; the body decides.
    respondWith(200, { error: 'Unknown table' })
    await assert.rejects(apiQuery('nope', '*'), ApiQueryError)
  })

  test('a network failure is not an empty table either', async () => {
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    const err = await apiQuery('leads', '*').then(() => null, e => e)
    assert.ok(err instanceof ApiQueryError)
    assert.equal(err.status, 0)
    assert.match(err.userMessage, /connection/i)
  })

  test('a genuinely empty table is still an empty array', async () => {
    respondWith(200, { data: [] })
    assert.deepEqual(await apiQuery('leads', '*'), [])
  })

  test('rows come back as rows', async () => {
    respondWith(200, { data: [{ id: 'a' }, { id: 'b' }] })
    assert.deepEqual(await apiQuery<{ id: string }>('leads', 'id'), [{ id: 'a' }, { id: 'b' }])
  })
})

describe('the query is built the way /api/data expects', () => {
  test('filters, ordering and limit all reach the URL', async () => {
    let seen = ''
    globalThis.fetch = (async (url: string) => {
      seen = String(url)
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }) as unknown as typeof fetch

    await apiQuery('payments', 'amount', {
      filters: [{ col: 'status', op: 'eq', val: 'paid' }],
      orderBy: 'created_at',
      orderAsc: false,
      limit: 50,
    })

    const q = new URLSearchParams(seen.split('?')[1])
    assert.equal(q.get('table'), 'payments')
    assert.equal(q.get('select'), 'amount')
    assert.equal(q.get('limit'), '50')
    assert.equal(q.get('orderBy'), 'created_at')
    assert.equal(q.get('orderAsc'), 'false')
    assert.deepEqual(JSON.parse(q.get('filters')!), [{ col: 'status', op: 'eq', val: 'paid' }])
  })

  test('no ordering params when none were asked for', async () => {
    let seen = ''
    globalThis.fetch = (async (url: string) => {
      seen = String(url)
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }) as unknown as typeof fetch

    await apiQuery('leads', '*')
    const q = new URLSearchParams(seen.split('?')[1])
    assert.equal(q.get('orderBy'), null)
    assert.equal(q.get('filters'), null)
  })
})

describe('nobody reintroduces a private copy', () => {
  /*
   * The bug above had to be found five times to be fixed once, because five
   * pages each had their own apiQuery. This fails if a sixth appears.
   */
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full, out)
      else if (/\.tsx?$/.test(e.name)) out.push(full)
    }
    return out
  }

  test('apiQuery is defined once, in lib/api/query.ts', () => {
    const offenders = walk('app')
      .concat(walk('components'), walk('hooks'))
      .filter(f => /function apiQuery\b/.test(readFileSync(f, 'utf8')))

    assert.deepEqual(offenders, [],
      'these define their own apiQuery — import it from @/lib/api/query so a ' +
      'fix lands everywhere:\n  ' + offenders.join('\n  '))
  })

  test('the pages that read through it handle the throw', () => {
    const pages = [
      'app/(portal)/admin/reports/page.tsx',
      'app/(portal)/finance/reports/page.tsx',
      'app/(portal)/pm/reports/page.tsx',
      'app/(portal)/admin/marketers/page.tsx',
      'app/(portal)/pm/leads/[id]/page.tsx',
    ]
    for (const page of pages) {
      const src = readFileSync(page, 'utf8')
      assert.match(src, /catch \(e\)[\s\S]{0,200}ApiQueryError/,
        `${page} calls apiQuery without catching the failure — it will render as a blank page`)
      assert.match(src, /<ErrorState/,
        `${page} catches the failure without telling anyone`)
    }
  })
})

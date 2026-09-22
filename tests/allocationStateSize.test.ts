import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * THE ALLOCATION STATE MUST FIT IN A URL.
 *
 * ── THE BUG THIS EXISTS FOR ────────────────────────────────────────────────
 *
 * The compare-and-swap matches on the stored value, and PostgREST puts
 * filters in the QUERY STRING. So `.eq('value', <document>)` builds a URL
 * containing the whole document.
 *
 * The document carried the allocation history inline — 300 entries. At
 * roughly 190 bytes an entry that is a 56KB document and an 80KB URL, against
 * a limit that is typically 8KB. Every allocation write was refused, the
 * retry loop exhausted itself, and NO LEAD WAS ASSIGNED.
 *
 * It worked on an empty database and broke as the history filled, which is
 * the worst shape a bug can have: it passes every test written against a
 * fresh database and stops the business days later. Nothing in the previous
 * test suite measured a size, so nothing caught it.
 *
 * These tests measure the real thing.
 */

const store = readFileSync('lib/leads/distributionStore.ts', 'utf8')

/** What supabase-js builds for the compare, now that it is a version token. */
function casUrlLength(): number {
  return ('https://project.supabase.co/rest/v1/settings'
    + '?key=eq.lead_distribution_version'
    + '&value=eq.' + encodeURIComponent('987654321')).length
}

/** The conservative limit servers and proxies impose on a URL. */
const URL_LIMIT = 8000

describe('the compare does not grow with the state', () => {
  test('the filter is a version token, not the document', () => {
    /*
     * Matching on the document built a URL containing the document — 80KB
     * with the history inline. Moving the history out was not enough either:
     * the members alone pass 8KB at around fifty people, so the fault would
     * have returned as the team grew.
     */
    assert.match(store, /const VERSION_KEY = 'lead_distribution_version'/)
    assert.match(store, /\.eq\('key', VERSION_KEY\)[\s\S]{0,120}\.eq\('value', String\(version\)\)/)
    assert.ok(!/\.eq\('value', expectedRaw\)/.test(store),
      'the document must never be the compare value again')
  })

  test('the filter is tiny whatever the state contains', () => {
    assert.ok(casUrlLength() < 200, `the compare URL is ${casUrlLength()} bytes`)
    assert.ok(casUrlLength() < URL_LIMIT / 20)
  })

  test('winning the token is what grants the right to write', () => {
    const fn = store.slice(store.indexOf('async function writeState'))
    const compare = fn.indexOf("eq('value', String(version))")
    const write = fn.indexOf("upsert({ key: KEY")
    assert.ok(compare > -1 && compare < write,
      'the document must only be written after the token is won')
    assert.match(fn.slice(0, 2200), /if \(\(data\?\.length \?\? 0\) === 0\) return false/)
  })

  test('a reader can tell a settled state from one mid-write', () => {
    // The token moves before the document lands; a mismatch means a write is
    // in flight and deciding now would discard it.
    /*
     * This used to assert `if (doc.version !== version) return null` — the
     * exact line that, with no token row on the production database, made
     * every read mismatch and assigned nothing. The test was pinning the bug.
     * A mismatch now waits briefly, then bootstraps or heals.
     */
    assert.match(store, /const decision = reconcileState\(doc\.version, tokenRaw, attempt\)/)
    assert.match(store, /if \(decision\.action === 'wait'\)/)
  })
})

describe('the history is not in the document', () => {
  test('the document type has no events field', () => {
    const type = store.slice(store.indexOf('export type DistributionDoc'))
    assert.ok(!/events/.test(type.slice(0, 220)),
      'the history in the document is what made the filter URL unsendable')
  })

  test('it is stored under its own key', () => {
    assert.match(store, /const EVENTS_KEY = 'lead_distribution_events'/)
  })

  test('and written unconditionally, so it cannot block an assignment', () => {
    const fn = store.slice(store.indexOf('async function appendEvent'))
    assert.match(fn.slice(0, 700), /\.upsert\(/)
    assert.ok(!/\.eq\('value'/.test(fn.slice(0, 700)),
      'the history must not be compare-and-swapped')
  })

  test('a failure to record history never fails the assignment', () => {
    const fn = store.slice(store.indexOf('async function appendEvent'))
    assert.match(fn.slice(0, 700), /catch \(e\) \{[\s\S]{0,120}console\.error/)
  })

  test('the event is recorded only after the lead is actually claimed', () => {
    const claim = store.indexOf("rpc('assign_lead_to'")
    const record = store.indexOf('await appendEvent(')
    assert.ok(claim > -1 && claim < record)
  })
})

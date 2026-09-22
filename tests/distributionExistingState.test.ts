import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reconcileState, runCycle, type MemberState } from '../lib/leads/distribution.ts'

/**
 * THE ALLOCATOR MUST WORK ON THE DATABASE PRODUCTION ACTUALLY HAS.
 *
 * Twice now the allocator has passed every test and assigned nothing in
 * production, and both times for the same reason: the tests started from an
 * empty store, and production did not.
 *
 * This time the document had been written by the previous scheme, which kept
 * its version inside the document — already well past zero — while the new
 * version-token row did not exist and read as 0. The reader treated every
 * mismatch as "a write is landing", looked again six times, and gave up. No
 * lead was assigned and no share could be saved.
 *
 * These tests start from the states a real database can be in.
 */

/** A settings table: key → value, with the reader's reconcile loop over it. */
class Settings {
  rows = new Map<string, string>()
  read() {
    const raw = this.rows.get('lead_distribution')
    const doc = raw ? JSON.parse(raw) : { version: 0, members: {} }
    return { doc, token: this.rows.has('lead_distribution_version') ? this.rows.get('lead_distribution_version')! : null }
  }

  /** Mirrors readState in lib/leads/distributionStore.ts. */
  readState(): { members: Record<string, MemberState>; version: number } {
    for (let attempt = 0; attempt < 12; attempt++) {
      const { doc, token } = this.read()
      const d = reconcileState(doc.version, token, attempt)
      if (d.action === 'proceed') return { members: doc.members, version: d.version }
      if (d.action === 'bootstrap') {
        this.rows.set('lead_distribution_version', String(d.version))
        return { members: doc.members, version: d.version }
      }
      if (d.action === 'heal' && this.rows.get('lead_distribution_version') === d.from) {
        this.rows.set('lead_distribution_version', String(d.version))
      }
    }
    throw new Error('never settled — this is the production failure')
  }

  /** Mirrors writeState: compare on the token, then write the document. */
  writeState(members: Record<string, MemberState>, version: number): boolean {
    if (this.rows.get('lead_distribution_version') !== String(version)) return false
    this.rows.set('lead_distribution_version', String(version + 1))
    this.rows.set('lead_distribution', JSON.stringify({ version: version + 1, members }))
    return true
  }
}

const m = (percent: number): MemberState => ({ percent, active: true, current: 0, received: 0, lastAt: null })

function deliver(db: Settings, eligible: string[], n: number) {
  const tally: Record<string, number> = {}
  for (const id of eligible) tally[id] = 0
  for (let i = 0; i < n; i++) {
    const { members, version } = db.readState()
    const cycle = runCycle(members, eligible.map(id => ({ id })), 'now')!
    assert.ok(db.writeState(cycle.members, version), 'an uncontended write must succeed')
    tally[cycle.chosen]++
  }
  return tally
}

describe('the state production was actually in', () => {
  test('a document from the previous scheme, with no token row, is adopted', () => {
    const db = new Settings()
    db.rows.set('lead_distribution', JSON.stringify({
      version: 57,   // the old scheme bumped this on every write
      members: { a: m(50), b: m(30), c: m(20) },
      events: new Array(40).fill({}),   // and carried its history inline
    }))
    assert.equal(db.rows.has('lead_distribution_version'), false)

    const got = deliver(db, ['a', 'b', 'c'], 100)
    assert.deepEqual(got, { a: 50, b: 30, c: 20 },
      'the configured shares must control assignment on the existing document')
    assert.equal(db.rows.get('lead_distribution_version'), '157')
  })

  test('the decision for that state is to bootstrap, not to wait', () => {
    assert.deepEqual(reconcileState(57, null, 0), { action: 'bootstrap', version: 57 })
  })

  test('the configured shares survive the adoption untouched', () => {
    const db = new Settings()
    db.rows.set('lead_distribution', JSON.stringify({ version: 9, members: { a: m(70), b: m(30) } }))
    const { members } = db.readState()
    assert.equal(members.a.percent, 70)
    assert.equal(members.b.percent, 30)
  })
})

describe('a writer that did not finish cannot block everybody forever', () => {
  test('a token left ahead of its document is healed', () => {
    const db = new Settings()
    db.rows.set('lead_distribution', JSON.stringify({ version: 12, members: { a: m(60), b: m(40) } }))
    db.rows.set('lead_distribution_version', '13')   // bumped, then the document write failed

    const got = deliver(db, ['a', 'b'], 50)
    assert.deepEqual(got, { a: 30, b: 20 })
  })

  test('a brief mismatch is waited out before anything is changed', () => {
    assert.deepEqual(reconcileState(12, '13', 0), { action: 'wait' })
    assert.deepEqual(reconcileState(12, '13', 2), { action: 'wait' })
    assert.deepEqual(reconcileState(12, '13', 3), { action: 'heal', from: '13', version: 12 })
  })

  test('a corrupt token is healed rather than read as zero', () => {
    assert.deepEqual(reconcileState(4, 'garbage', 0), { action: 'heal', from: 'garbage', version: 4 })
  })

  test('the heal is conditional, so it cannot overwrite a newer write', () => {
    const store = readFileSync('lib/leads/distributionStore.ts', 'utf8')
    const heal = store.slice(store.indexOf('heal: a mismatch that outlasted'))
    assert.match(heal.slice(0, 900), /\.eq\('value', decision\.from\)/)
  })
})

describe('a fresh database still works', () => {
  test('no document and no token', () => {
    const db = new Settings()
    const got = deliver(db, ['a', 'b', 'c'], 30)
    assert.equal(got.a + got.b + got.c, 30)
  })

  test('a settled state proceeds without writing anything', () => {
    assert.deepEqual(reconcileState(8, '8', 0), { action: 'proceed', version: 8 })
  })
})

describe('the reader in the store uses this decision', () => {
  const store = readFileSync('lib/leads/distributionStore.ts', 'utf8')

  test('it no longer returns null on a mismatch', () => {
    // `if (doc.version !== version) return null` is what assigned nothing.
    assert.ok(!/if \(doc\.version !== version\) return null/.test(store))
    assert.match(store, /const decision = reconcileState\(doc\.version, tokenRaw, attempt\)/)
  })

  test('a missing token is told apart from a token of zero', () => {
    assert.match(store, /rows\.has\(VERSION_KEY\) \? String\(rows\.get\(VERSION_KEY\) \?\? ''\) : null/)
  })

  test('every write is a compare, including the first', () => {
    const fn = store.slice(store.indexOf('async function writeState'))
    assert.ok(!/if \(version === 0\)/.test(fn.slice(0, 1500)),
      'the first write must not bypass the compare')
    assert.match(fn.slice(0, 1500), /\.eq\('value', String\(version\)\)/)
  })
})

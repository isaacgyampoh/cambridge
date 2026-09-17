import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { runCycle, type MemberState } from '../lib/leads/distribution.ts'

/**
 * DOES A CONFIGURED PERCENTAGE ACTUALLY DECIDE WHO GETS THE LEAD?
 *
 * Every previous test of this either exercised pickWeighted on its own — the
 * arithmetic, in isolation — or read the store's source and asserted it
 * looked right. Neither ran a lead through the cycle the application uses, so
 * the allocator was completely broken in production while its tests passed.
 *
 * These drive the REAL decision function through the REAL persistence shape:
 * read the stored members, run the cycle, save what it returns, read it back
 * for the next lead. That is exactly what distributeLead does between its
 * database calls.
 */

/** Stands in for the settings row: the state survives between leads. */
class Store {
  private raw: string
  constructor(initial: Record<string, MemberState> = {}) {
    this.raw = JSON.stringify({ version: 0, members: initial })
  }
  read(): Record<string, MemberState> {
    return JSON.parse(this.raw).members
  }
  write(members: Record<string, MemberState>) {
    const v = JSON.parse(this.raw).version
    this.raw = JSON.stringify({ version: v + 1, members })
  }
  /** What a deployment does: the process goes, the row stays. */
  redeploy(): Store {
    const next = new Store()
    next.raw = this.raw
    return next
  }
}

const member = (percent: number, active = true): MemberState =>
  ({ percent, active, current: 0, received: 0, lastAt: null })

function deliver(store: Store, eligible: string[], count: number): Record<string, number> {
  const tally: Record<string, number> = {}
  for (const id of eligible) tally[id] = 0
  for (let i = 0; i < count; i++) {
    const cycle = runCycle(store.read(), eligible.map(id => ({ id })), new Date().toISOString())
    if (!cycle) break
    tally[cycle.chosen] = (tally[cycle.chosen] ?? 0) + 1
    store.write(cycle.members)          // ← persisted, exactly as the store does
  }
  return tally
}

describe('the configured percentage decides who gets the lead', () => {
  test('50/30/20 over 100 leads', () => {
    const store = new Store({ a: member(50), b: member(30), c: member(20) })
    assert.deepEqual(deliver(store, ['a', 'b', 'c'], 100), { a: 50, b: 30, c: 20 })
  })

  test('50/30/20 over 1000 leads', () => {
    const store = new Store({ a: member(50), b: member(30), c: member(20) })
    assert.deepEqual(deliver(store, ['a', 'b', 'c'], 1000), { a: 500, b: 300, c: 200 })
  })

  test('40/40/20', () => {
    const store = new Store({ a: member(40), b: member(40), c: member(20) })
    assert.deepEqual(deliver(store, ['a', 'b', 'c'], 100), { a: 40, b: 40, c: 20 })
  })

  test('one person on 100% takes everything', () => {
    const store = new Store({ a: member(100), b: member(0), c: member(0) })
    assert.deepEqual(deliver(store, ['a', 'b', 'c'], 40), { a: 40, b: 0, c: 0 })
  })

  test('an uneven split that does not divide cleanly still converges', () => {
    const store = new Store({ a: member(33.34), b: member(33.33), c: member(33.33) })
    const got = deliver(store, ['a', 'b', 'c'], 300)
    for (const id of ['a', 'b', 'c']) {
      assert.ok(Math.abs(got[id] - 100) <= 1, `${id} received ${got[id]} of 300`)
    }
  })

  test('the received counter matches what was actually handed out', () => {
    const store = new Store({ a: member(70), b: member(30) })
    const got = deliver(store, ['a', 'b'], 50)
    const saved = store.read()
    assert.equal(saved.a.received, got.a)
    assert.equal(saved.b.received, got.b)
    assert.equal(saved.a.received + saved.b.received, 50)
  })
})

describe('the state survives a deployment', () => {
  test('a run split across two deployments matches one unbroken run', () => {
    /*
     * The scheduler's position is carried in the stored state. If a
     * deployment reset it, whoever came first alphabetically would take a
     * burst every time the application restarted.
     */
    const straight = deliver(new Store({ a: member(50), b: member(30), c: member(20) }), ['a', 'b', 'c'], 100)

    let store = new Store({ a: member(50), b: member(30), c: member(20) })
    const first = deliver(store, ['a', 'b', 'c'], 37)
    store = store.redeploy()
    const second = deliver(store, ['a', 'b', 'c'], 63)

    const combined = {
      a: first.a + second.a, b: first.b + second.b, c: first.c + second.c,
    }
    assert.deepEqual(combined, straight)
  })
})

describe('who takes part', () => {
  test('somebody switched off receives nothing', () => {
    const store = new Store({ a: member(50), b: member(50, false) })
    const got = deliver(store, ['a', 'b'], 30)
    assert.equal(got.b, 0)
    assert.equal(got.a, 30)
  })

  test('and their stored position is not disturbed', () => {
    const store = new Store({
      a: member(100),
      b: { percent: 50, active: false, current: -12.5, received: 9, lastAt: '2026-01-01T00:00:00.000Z' },
    })
    deliver(store, ['a', 'b'], 20)
    const after = store.read()
    assert.equal(after.b.current, -12.5)
    assert.equal(after.b.received, 9)
    assert.equal(after.b.lastAt, '2026-01-01T00:00:00.000Z')
  })

  test('somebody not eligible at all is untouched', () => {
    // On leave, or their access removed: their position must survive intact.
    const store = new Store({
      a: member(50), b: member(50),
      away: { percent: 25, active: true, current: 40, received: 77, lastAt: null },
    })
    deliver(store, ['a', 'b'], 20)
    assert.deepEqual(store.read().away,
      { percent: 25, active: true, current: 40, received: 77, lastAt: null })
  })

  test('nobody configured yet still gets an even rotation, not a halt', () => {
    const store = new Store({})
    const got = deliver(store, ['a', 'b', 'c'], 30)
    assert.equal(got.a + got.b + got.c, 30, 'leads must keep flowing before anybody configures shares')
    for (const id of ['a', 'b', 'c']) assert.ok(got[id] >= 9 && got[id] <= 11, `${id}: ${got[id]}`)
  })

  test('an empty pool is a real answer, not an arbitrary pick', () => {
    assert.equal(runCycle({}, [], new Date().toISOString()), null)
  })
})

describe('changing the percentages', () => {
  test('applies to future leads only, and without a catch-up burst', () => {
    const store = new Store({ a: member(50), b: member(30), c: member(20) })
    const before = deliver(store, ['a', 'b', 'c'], 100)
    assert.deepEqual(before, { a: 50, b: 30, c: 20 })

    // The manager changes the split. Counters and positions carry over.
    const members = store.read()
    members.a.percent = 20
    members.b.percent = 40
    members.c.percent = 40
    store.write(members)

    const after = deliver(store, ['a', 'b', 'c'], 100)
    for (const [id, want] of [['a', 20], ['b', 40], ['c', 40]] as const) {
      assert.ok(Math.abs(after[id] - want) <= 2, `${id} received ${after[id]}, expected about ${want}`)
    }
  })

  test('history is not rewritten by the change', () => {
    const store = new Store({ a: member(100), b: member(0) })
    deliver(store, ['a', 'b'], 10)
    const receivedBefore = store.read().a.received

    const members = store.read()
    members.a.percent = 0
    members.b.percent = 100
    store.write(members)

    assert.equal(store.read().a.received, receivedBefore,
      'what somebody already received must not change because a share did')
  })
})

describe('the method reported is the one used', () => {
  test('weighted when shares are configured', () => {
    const cycle = runCycle({ a: member(60), b: member(40) }, [{ id: 'a' }, { id: 'b' }], 'now')
    assert.equal(cycle?.method, 'weighted')
    assert.equal(cycle?.weight, 60)
  })

  test('equal_rotation when none are, and no weight is claimed', () => {
    const cycle = runCycle({}, [{ id: 'a' }, { id: 'b' }], 'now')
    assert.equal(cycle?.method, 'equal_rotation')
    assert.equal(cycle?.weight, null)
  })
})

describe('two leads arriving together', () => {
  test('the loser recomputing from the winner’s state still converges', () => {
    /*
     * The store resolves a race by making the loser read again and decide
     * from what the winner wrote. This is that, repeated: every second lead
     * is computed twice and only the second result is kept.
     */
    const store = new Store({ a: member(50), b: member(30), c: member(20) })
    const eligible = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const tally: Record<string, number> = { a: 0, b: 0, c: 0 }

    for (let i = 0; i < 100; i++) {
      const snapshot = store.read()
      runCycle(snapshot, eligible, 'now')          // the losing attempt, discarded
      const winner = runCycle(store.read(), eligible, 'now')!
      tally[winner.chosen]++
      store.write(winner.members)
    }
    assert.deepEqual(tally, { a: 50, b: 30, c: 20 })
  })
})

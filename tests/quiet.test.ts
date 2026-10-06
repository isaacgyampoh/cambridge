import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { runQuietly } from '../lib/quiet.ts'

/**
 * These pin the one property the callers depend on: runQuietly never rejects.
 * Every site using it has already committed its real work by the time it is
 * reached, so a throw escaping here is the bug it exists to prevent.
 */
describe('runQuietly', () => {
  const quiet = () => {
    const lines: unknown[][] = []
    return { log: (...a: unknown[]) => { lines.push(a) }, lines }
  }

  test('one rejection does not discard the others', async () => {
    const done: string[] = []
    const { log } = quiet()
    const out = await runQuietly('[t]', [
      (async () => { done.push('a') })(),
      Promise.reject(new Error('unreachable number')),
      (async () => { done.push('c') })(),
    ], log)

    assert.deepEqual(done, ['a', 'c'], 'the healthy sends still ran')
    assert.equal(out.total, 3)
    assert.equal(out.failed, 1)
    assert.deepEqual(out.reasons, ['unreachable number'])
  })

  test('it does not reject even when every task fails', async () => {
    const { log } = quiet()
    const out = await runQuietly('[t]', [
      Promise.reject(new Error('one')),
      Promise.reject(new Error('two')),
    ], log)
    assert.equal(out.failed, 2)
    assert.deepEqual(out.reasons, ['one', 'two'])
  })

  test('a non-Error rejection is still reported, not swallowed', async () => {
    const { log } = quiet()
    const out = await runQuietly('[t]', [Promise.reject('just a string'), Promise.reject(null)], log)
    assert.equal(out.failed, 2)
    assert.deepEqual(out.reasons, ['just a string', 'null'])
  })

  test('a thunk that throws synchronously is caught', async () => {
    // Without the thunk form this throw would escape while the list was being
    // built, before allSettled could see it.
    const { log } = quiet()
    const out = await runQuietly('[t]', [
      () => { throw new Error('threw before awaiting') },
      Promise.resolve('fine'),
    ], log)
    assert.equal(out.failed, 1)
    assert.deepEqual(out.reasons, ['threw before awaiting'])
  })

  test('every failure is logged, with the caller label', async () => {
    const { log, lines } = quiet()
    await runQuietly('[admissions]', [Promise.reject(new Error('boom'))], log)
    assert.equal(lines.length, 1)
    assert.equal(lines[0][0], '[admissions]')
    assert.match(String(lines[0][2]), /boom/)
  })

  test('nothing to do is not a failure', async () => {
    const { log, lines } = quiet()
    const out = await runQuietly('[t]', [], log)
    assert.deepEqual(out, { total: 0, failed: 0, reasons: [] })
    assert.equal(lines.length, 0, 'and it says nothing')
  })

  test('all succeeding reports no failures', async () => {
    const { log } = quiet()
    const out = await runQuietly('[t]', [Promise.resolve(1), Promise.resolve(2)], log)
    assert.deepEqual(out, { total: 2, failed: 0, reasons: [] })
  })
})

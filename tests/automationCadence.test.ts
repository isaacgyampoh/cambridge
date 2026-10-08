import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cadenceOf, cadenceNote, describeInterval, runnerHealth, type TaskRun } from '../lib/automation/cadence.ts'

const NOW = Date.parse('2026-10-08T12:00:00Z')
const agoMins = (m: number) => new Date(NOW - m * 60000).toISOString()

/**
 * On Vercel's free plan a scheduled job runs at most once a day, so the
 * five- and ten-minute intervals in the cron fan-out are wishes, not a
 * schedule. These cover reporting that honestly.
 */

describe('whether one task is keeping its own interval', () => {
  const task = (everyMins: number, lastRunAt: string | null): TaskRun =>
    ({ task: 't', everyMins, lastRunAt })

  test('just run is on schedule', () => {
    assert.equal(cadenceOf(task(10, agoMins(1)), NOW), 'on_schedule')
  })

  test('ordinary jitter is not late', () => {
    // A ten-minute task invoked nineteen minutes apart is the fan-out landing
    // where it lands, not a fault.
    assert.equal(cadenceOf(task(10, agoMins(19)), NOW), 'on_schedule')
  })

  test('a day later, a ten-minute task is late', () => {
    assert.equal(cadenceOf(task(10, agoMins(1440)), NOW), 'late')
  })

  test('a daily task a day later is not late', () => {
    // The commonest false positive: daily tasks are fine on the free plan and
    // must not be reported as broken alongside the ones that are not.
    assert.equal(cadenceOf(task(1440, agoMins(1440)), NOW), 'on_schedule')
    assert.equal(cadenceOf(task(1440, agoMins(1500)), NOW), 'on_schedule')
  })

  test('never run is said plainly', () => {
    assert.equal(cadenceOf(task(10, null), NOW), 'never')
    assert.equal(cadenceOf(task(10, 'not a date'), NOW), 'never')
    assert.equal(cadenceNote(task(10, null), NOW), 'Has never run')
  })

  test('the note says what it asks for when it is not getting it', () => {
    assert.match(cadenceNote(task(10, agoMins(1440)), NOW), /asks for every 10 min/i)
    assert.match(cadenceNote(task(10, agoMins(2)), NOW), /^Every 10 min$/)
  })
})

describe('intervals read as words', () => {
  test('each band', () => {
    assert.equal(describeInterval(5), '5 min')
    assert.equal(describeInterval(60), '1 hour')
    assert.equal(describeInterval(120), '2 hours')
    assert.equal(describeInterval(1440), '1 day')
    assert.equal(describeInterval(10080), '1 week')
  })
})

describe('the shape of the problem across all the tasks', () => {
  const subDaily = (lastRunAt: string | null): TaskRun[] => [
    { task: 'sms_queue', everyMins: 5, lastRunAt },
    { task: 'lead_sweep', everyMins: 10, lastRunAt },
    { task: 'class_start', everyMins: 10, lastRunAt },
    { task: 'sequences', everyMins: 15, lastRunAt },
  ]

  test('all of them starved at once reads as a daily runner', () => {
    const h = runnerHealth([...subDaily(agoMins(1400)), { task: 'reports', everyMins: 1440, lastRunAt: agoMins(1400) }], NOW)
    assert.equal(h.looksDaily, true)
    assert.equal(h.starved.length, 4, 'the daily task is not starved and must not be counted')
    assert.match(h.headline || '', /free plan/)
    assert.match(h.headline || '', /five-minute pinger/)
  })

  test('one late task is just a task, not a diagnosis', () => {
    const tasks = subDaily(agoMins(2))
    tasks[0] = { task: 'sms_queue', everyMins: 5, lastRunAt: agoMins(600) }
    const h = runnerHealth(tasks, NOW)
    assert.equal(h.looksDaily, false)
    assert.deepEqual(h.starved, ['sms_queue'])
    assert.match(h.headline || '', /1 automation is/)
  })

  test('everything healthy says nothing at all', () => {
    const h = runnerHealth(subDaily(agoMins(2)), NOW)
    assert.equal(h.headline, null)
    assert.deepEqual(h.starved, [])
  })

  test('too few tasks to generalise from', () => {
    // Two starved tasks is not evidence that the runner is daily.
    const h = runnerHealth([
      { task: 'a', everyMins: 5, lastRunAt: agoMins(1400) },
      { task: 'b', everyMins: 10, lastRunAt: agoMins(1400) },
    ], NOW)
    assert.equal(h.looksDaily, false)
  })

  test('daily-only tasks never trigger the diagnosis', () => {
    // A deployment with nothing sub-daily is not broken.
    const h = runnerHealth([
      { task: 'reports', everyMins: 1440, lastRunAt: agoMins(1400) },
      { task: 'prune', everyMins: 1440, lastRunAt: agoMins(1400) },
      { task: 'tiers', everyMins: 10080, lastRunAt: agoMins(1400) },
    ], NOW)
    assert.equal(h.looksDaily, false)
    assert.equal(h.headline, null)
  })
})

describe('the screen and the runner agree about the intervals', () => {
  test('every task in the fan-out has the same interval on the page', () => {
    const runner = readFileSync('app/api/cron/run/route.ts', 'utf8')
    const page = readFileSync('app/(portal)/admin/automation/page.tsx', 'utf8')

    /*
     * The page states each interval a second time so it can judge the
     * cadence. Two copies of one fact drift, and a drifted copy makes the
     * note on screen wrong in a way nobody would notice — so they are
     * compared here rather than trusted.
     */
    const fromRunner = new Map<string, number>()
    for (const m of runner.matchAll(/name: '([a-z_]+)',\s*path: '[^']+',\s*everyMins: (\d+)/g)) {
      fromRunner.set(m[1], Number(m[2]))
    }
    assert.ok(fromRunner.size >= 10, `parsed only ${fromRunner.size} tasks from the runner`)

    const fromPage = new Map<string, number>()
    for (const m of page.matchAll(/^\s{2}([a-z_]+):\s*\{[^}]*everyMins: (\d+)/gm)) {
      fromPage.set(m[1], Number(m[2]))
    }
    assert.ok(fromPage.size >= 10, `parsed only ${fromPage.size} tasks from the page`)

    for (const [task, mins] of fromPage) {
      assert.equal(fromRunner.get(task), mins,
        `${task}: the page says ${mins} min, the runner says ${fromRunner.get(task)}`)
    }
  })
})

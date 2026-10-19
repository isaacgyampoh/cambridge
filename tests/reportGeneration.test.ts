import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  statsForRange, calendarMonth, slidingRange, rateLabel, type LeadRow,
} from '../lib/analytics/leadStats.ts'

const NOW = new Date('2026-10-19T12:00:00Z')
const adm = (pairs: [string, string][]) => new Map(pairs)
const lead = (o: Partial<LeadRow> & { id: string }): LeadRow => ({
  status: 'new', assigned_at: '2026-10-05T09:00:00Z', created_at: '2026-10-05T09:00:00Z', ...o,
})
const code = (p: string) => readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * The generated report was described as meaningless. It was, for three
 * reasons, and each is covered here.
 */

describe('a month is a month', () => {
  test('monthly covers the calendar month, not the last thirty days', () => {
    // It used setMonth(now.getMonth() - 1): a sliding window ending today, so
    // two reports a day apart covered different periods and neither was
    // "what we did in September".
    const r = calendarMonth('2026-09')
    assert.equal(r.startISO, '2026-09-01T00:00:00.000Z')
    assert.equal(r.endISO, '2026-10-01T00:00:00.000Z')
  })

  test('the boundary belongs to exactly one period', () => {
    const sept = calendarMonth('2026-09')
    const oct = calendarMonth('2026-10')
    const onTheLine = [lead({ id: '1', assigned_at: '2026-10-01T00:00:00.000Z' })]
    assert.equal(statsForRange(onTheLine, adm([]), sept, NOW).received, 0)
    assert.equal(statsForRange(onTheLine, adm([]), oct, NOW).received, 1)
  })

  test('December into January keeps the year', () => {
    const r = calendarMonth('2026-12')
    assert.equal(r.endISO, '2027-01-01T00:00:00.000Z')
  })

  test('daily and weekly stay sliding, which is what they want', () => {
    const d = slidingRange(NOW, 1)
    assert.equal(d.endISO, NOW.toISOString())
    assert.equal(new Date(d.startISO).getTime(), NOW.getTime() - 86400000)
  })
})

describe('conversions stop going missing', () => {
  test('a lead received in September and registered in October counts in October', () => {
    /*
     * The old rule counted "leads ASSIGNED in the period that are registered
     * today", so this lead belonged to neither report: October never saw it
     * because it was not assigned in October, and September's was already
     * written. That is how a report shows leads handled and nought converted.
     */
    const rows = [lead({ id: '1', status: 'registered', assigned_at: '2026-09-10T09:00:00Z' })]
    const a = adm([['1', '2026-10-03T09:00:00Z']])
    assert.equal(statsForRange(rows, a, calendarMonth('2026-10'), NOW).convertedInPeriod, 1)
    assert.equal(statsForRange(rows, a, calendarMonth('2026-09'), NOW).convertedInPeriod, 0)
  })

  test('and September still gets credit for receiving it', () => {
    const rows = [lead({ id: '1', status: 'registered', assigned_at: '2026-09-10T09:00:00Z' })]
    assert.equal(statsForRange(rows, adm([]), calendarMonth('2026-09'), NOW).received, 1)
  })

  test('a registration with no dated record is not counted', () => {
    const rows = [lead({ id: '1', status: 'registered' })]
    assert.equal(statsForRange(rows, adm([]), calendarMonth('2026-10'), NOW).convertedInPeriod, 0)
  })
})

describe('an empty month does not read as a failure', () => {
  test('no leads received gives no rate at all', () => {
    assert.equal(statsForRange([], adm([]), calendarMonth('2026-10'), NOW).conversionRate, null)
    assert.equal(rateLabel(null), 'no leads received')
  })

  test('leads received and none converted really is 0%', () => {
    const rows = [lead({ id: '1' })]
    assert.equal(statsForRange(rows, adm([]), calendarMonth('2026-10'), NOW).conversionRate, 0)
    assert.equal(rateLabel(0), '0%')
  })
})

describe('the report is written for people who work leads', () => {
  const s = code('lib/generateReports.ts')

  test('the pool comes from the one source of truth', () => {
    /*
     * It was "every active profile that is not a super admin", so students,
     * receptionists and administrators each got an empty report. A list
     * mostly made of nought is a list nobody reads.
     */
    assert.match(s, /eligibleMarketers\(\)/)
    assert.doesNotMatch(s, /neq\('role', 'super_admin'\)/,
      'the pool must not be rebuilt by hand here')
  })

  test('conversions are dated from the admission', () => {
    assert.match(s, /from\('admissions'\)/)
    assert.match(s, /statsForRange\(/)
  })

  test('it does not count "assigned in the period and registered today"', () => {
    assert.doesNotMatch(s, /filter\(\(l: any\) => l\.status === 'registered'\)/)
  })

  test('a report that fails to save is reported, not swallowed', () => {
    // It was wrapped in a bare try/catch, so a failed write was
    // indistinguishable from a report that was never due.
    assert.match(s, /failures\.push\(/)
    assert.match(s, /failed: failures\.length/)
  })

  test('the period is calendar-based for monthly', () => {
    assert.match(s, /calendarMonth\(/)
    assert.doesNotMatch(s, /setMonth\(now\.getMonth\(\) - 1\)/)
  })

  test('activity counts are bounded at both ends of the period', () => {
    // gte alone counts everything since the start, including after the period
    // ended — which inflates an old report every time it is regenerated.
    assert.match(s, /\.gte\('created_at', range\.startISO\)\.lt\('created_at', range\.endISO\)/)
  })
})

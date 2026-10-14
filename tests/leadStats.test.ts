import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  statsForMonth, statsAllTime, monthlySeries, recentMonths, monthKeyOf, monthLabel,
  type LeadRow,
} from '../lib/analytics/leadStats.ts'

const NOW = new Date('2026-10-14T12:00:00Z')
const adm = (pairs: [string, string][]) => new Map(pairs)

const lead = (o: Partial<LeadRow> & { id: string }): LeadRow => ({
  status: 'new', assigned_at: '2026-10-02T09:00:00Z', created_at: '2026-10-01T09:00:00Z', ...o,
})

/**
 * The centre runs a cohort a month, so these figures are what a month's work
 * is judged on. Two things had to be separated to make them mean anything:
 * the day a lead was CREATED from the day somebody RECEIVED it, and the fact
 * that a lead converted from the date it did.
 */

describe('received is not created', () => {
  test('a lead captured in August and given out in October is October’s', () => {
    // The dashboard counted this as August's, in a month the person had
    // nothing to do with.
    const rows = [lead({ id: '1', created_at: '2026-08-20T09:00:00Z', assigned_at: '2026-10-02T09:00:00Z' })]
    assert.equal(statsForMonth(rows, adm([]), '2026-10', NOW).received, 1)
    assert.equal(statsForMonth(rows, adm([]), '2026-08', NOW).received, 0)
  })

  test('both dates are still reported, not one swapped for the other', () => {
    const rows = [lead({ id: '1', created_at: '2026-08-20T09:00:00Z', assigned_at: '2026-10-02T09:00:00Z' })]
    assert.equal(statsForMonth(rows, adm([]), '2026-08', NOW).created, 1)
    assert.equal(statsForMonth(rows, adm([]), '2026-10', NOW).created, 0)
  })

  test('a lead never handed to anybody belongs to no month, and is counted as such', () => {
    const rows = [lead({ id: '1', assigned_at: null })]
    assert.equal(statsForMonth(rows, adm([]), '2026-10', NOW).received, 0)
    assert.equal(statsAllTime(rows, adm([])).undated, 1)
  })
})

describe('converted, and when', () => {
  test('a conversion counts in the month it happened, not the month the lead arrived', () => {
    // A monthly cohort report means "what did we convert this month".
    const rows = [lead({ id: '1', status: 'registered', assigned_at: '2026-08-05T09:00:00Z' })]
    const a = adm([['1', '2026-10-03T09:00:00Z']])
    assert.equal(statsForMonth(rows, a, '2026-10', NOW).convertedInPeriod, 1)
    assert.equal(statsForMonth(rows, a, '2026-08', NOW).convertedInPeriod, 0)
    // And August still owns the receipt.
    assert.equal(statsForMonth(rows, a, '2026-08', NOW).received, 1)
  })

  test('registered with no admission is not counted as converted', () => {
    /*
     * The honest answer when the dated record is missing. Counting it anyway
     * would put a conversion in whatever month the reader happened to ask
     * about.
     */
    const rows = [lead({ id: '1', status: 'registered' })]
    assert.equal(statsForMonth(rows, adm([]), '2026-10', NOW).convertedInPeriod, 0)
    assert.equal(statsAllTime(rows, adm([])).converted, 0)
  })

  test('an admission for a lead that is not registered is not a conversion', () => {
    const rows = [lead({ id: '1', status: 'contacted' })]
    assert.equal(statsForMonth(rows, adm([['1', '2026-10-03T09:00:00Z']]), '2026-10', NOW).convertedInPeriod, 0)
  })

  test('a second admission does not double-count the student', () => {
    const rows = [lead({ id: '1', status: 'registered' })]
    const s = statsForMonth(rows, adm([['1', '2026-10-03T09:00:00Z']]), '2026-10', NOW)
    assert.equal(s.convertedInPeriod, 1)
    assert.deepEqual(s.convertedIds, ['1'])
  })
})

describe('a rate of nothing is not zero', () => {
  test('no leads received gives null, not 0%', () => {
    // "0% conversion" and "nothing came in" are different facts, and showing
    // the first when the second is true is how a report loses its reader.
    assert.equal(statsForMonth([], adm([]), '2026-10', NOW).conversionRate, null)
    assert.equal(statsAllTime([], adm([])).conversionRate, null)
  })

  test('leads received and none converted really is zero', () => {
    const rows = [lead({ id: '1' })]
    assert.equal(statsForMonth(rows, adm([]), '2026-10', NOW).conversionRate, 0)
  })

  test('the rate is a percentage of what came in, to one decimal', () => {
    const rows = [lead({ id: '1', status: 'registered' }), lead({ id: '2' }), lead({ id: '3' })]
    const s = statsForMonth(rows, adm([['1', '2026-10-03T09:00:00Z']]), '2026-10', NOW)
    assert.equal(s.received, 3)
    assert.equal(s.convertedInPeriod, 1)
    assert.equal(s.conversionRate, 33.3)
  })
})

describe('month boundaries', () => {
  test('the first and last instants of a month belong to it', () => {
    const first = [lead({ id: 'a', assigned_at: '2026-10-01T00:00:00.000Z' })]
    const last = [lead({ id: 'b', assigned_at: '2026-10-31T23:59:59.999Z' })]
    assert.equal(statsForMonth(first, adm([]), '2026-10', NOW).received, 1)
    assert.equal(statsForMonth(last, adm([]), '2026-10', NOW).received, 1)
  })

  test('a moment either side does not', () => {
    const before = [lead({ id: 'a', assigned_at: '2026-09-30T23:59:59.999Z' })]
    const after = [lead({ id: 'b', assigned_at: '2026-11-01T00:00:00.000Z' })]
    assert.equal(statsForMonth(before, adm([]), '2026-10', NOW).received, 0)
    assert.equal(statsForMonth(after, adm([]), '2026-10', NOW).received, 0)
  })

  test('December rolls into January without losing a month', () => {
    const months = recentMonths(new Date('2026-01-15T00:00:00Z'), 3)
    assert.deepEqual(months, ['2026-01', '2025-12', '2025-11'])
  })

  test('twelve months are offered, newest first', () => {
    const months = recentMonths(NOW, 12)
    assert.equal(months.length, 12)
    assert.equal(months[0], '2026-10')
    assert.equal(months[11], '2025-11')
  })

  test('a month reads as words', () => {
    assert.equal(monthLabel('2026-10'), 'October 2026')
    assert.equal(monthKeyOf('2026-10-14T12:00:00Z'), '2026-10')
    assert.equal(monthKeyOf(null), null)
    assert.equal(monthKeyOf('not a date'), null)
  })
})

describe('the numbers behind the numbers', () => {
  test('the ids of what was counted come back, so a screen can show them', () => {
    const rows = [lead({ id: 'x', status: 'registered' }), lead({ id: 'y' })]
    const s = statsForMonth(rows, adm([['x', '2026-10-03T09:00:00Z']]), '2026-10', NOW)
    assert.deepEqual(s.receivedIds.sort(), ['x', 'y'])
    assert.deepEqual(s.convertedIds, ['x'])
  })

  test('a follow-up that is due counts; one in the future does not', () => {
    const due = [lead({ id: '1', status: 'contacted', follow_up_at: '2026-10-10T09:00:00Z' })]
    const later = [lead({ id: '2', status: 'contacted', follow_up_at: '2026-10-30T09:00:00Z' })]
    assert.equal(statsForMonth(due, adm([]), '2026-10', NOW).followUpsDue, 1)
    assert.equal(statsForMonth(later, adm([]), '2026-10', NOW).followUpsDue, 0)
  })

  test('a closed lead is not chased', () => {
    for (const status of ['registered', 'lost', 'not_interested', 'done']) {
      const rows = [lead({ id: '1', status, follow_up_at: '2026-10-10T09:00:00Z' })]
      assert.equal(statsForMonth(rows, adm([]), '2026-10', NOW).followUpsDue, 0, status)
    }
  })

  test('the monthly series covers every month asked for', () => {
    const rows = [lead({ id: '1', assigned_at: '2026-09-10T09:00:00Z' })]
    const series = monthlySeries(rows, adm([]), ['2026-10', '2026-09'], NOW)
    assert.equal(series.length, 2)
    assert.equal(series[0].received, 0)
    assert.equal(series[1].received, 1)
    assert.equal(series[1].label, 'September 2026')
  })
})

describe('the conversion is written down when it happens', () => {
  const s = readFileSync('lib/registration/complete.ts', 'utf8')

  test('registering logs the status transition', () => {
    /*
     * It did not. /api/leads/status logged manual edits and this path set the
     * status directly, so lead_status_logs held every change a person made by
     * hand and not one actual registration.
     */
    assert.match(s, /from\('lead_status_logs'\)\.insert\(\{[\s\S]{0,200}?new_status: 'registered'/)
  })

  test('a failed log does not cost the student their registration', () => {
    /*
     * Scoped to THIS statement. A fixed-size window reached into the
     * lead_activities insert that follows, which has a guard of its own — so
     * removing this one's guard left the test passing on the next
     * statement's.
     */
    const at = s.indexOf("from('lead_status_logs')")
    assert.notEqual(at, -1)
    const nextStatement = s.indexOf('await sb.from(', at + 10)
    assert.notEqual(nextStatement, -1, 'expected another statement after it')
    const stmt = s.slice(at, nextStatement)
    assert.match(stmt, /\.then\(\(\) => \{\}, /, 'the insert must not be able to throw')
  })
})

describe('the dashboard counts by the day the lead was received', () => {
  const s = readFileSync('app/api/marketer/dashboard/route.ts', 'utf8')

  test('assigned_at is selected at all', () => {
    assert.match(s, /select\('status, created_at, updated_at, assigned_at'\)/)
  })

  test('the daily figure uses it', () => {
    assert.match(s, /new Date\(l\.assigned_at \|\| l\.created_at\)/)
  })
})

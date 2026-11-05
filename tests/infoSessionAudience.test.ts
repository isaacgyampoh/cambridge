import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  rangeFor, matchesFilter, describeFilter, isEmptyFilter, DATE_PRESETS, TIMEZONE,
  type AudienceFilter, type MatchableLead,
} from '../lib/leads/audienceFilter.ts'
import {
  renderMessage, countSegments, sessionWhen, PLACEHOLDERS,
  messageForSession, LEGACY_INVITATION,
} from '../lib/leads/messageTemplate.ts'

/**
 * CHOOSING WHO AN INVITATION GOES TO, AND WRITING WHAT IT SAYS.
 *
 * ── WHAT THIS REPLACED ─────────────────────────────────────────────────────
 *
 * One dropdown with three entries — all active leads, uncontacted, interested
 * — and an invitation text that lived in the code. "The people who came in
 * last month who want PMP" could not be asked for, and every campaign said
 * the same sentence in the same words.
 */

/* 5 Nov 2026 is a Thursday. Accra keeps GMT all year, so an Accra day and a
 * UTC day are the same day — stated rather than relied on silently. */
const NOW = new Date('2026-11-05T14:30:00Z')
const lead = (over: Partial<MatchableLead> = {}): MatchableLead => ({
  created_at: '2026-11-03T09:00:00Z', status: 'new', source: 'manual',
  landing_source: 'Imported', course_interest: 'PMP', industry: 'mining',
  assigned_to: 'staff-1', ...over,
})

describe('when a lead entered the system', () => {
  test('"this month" is the Accra month, from its first midnight', () => {
    const { fromISO, toISO } = rangeFor({ addedWithin: 'this_month' }, NOW)
    assert.equal(fromISO, '2026-11-01T00:00:00.000Z')
    assert.equal(toISO, '2026-12-01T00:00:00.000Z')
  })

  test('"last month" and "two months ago" are whole months', () => {
    assert.deepEqual(rangeFor({ addedWithin: 'last_month' }, NOW), {
      fromISO: '2026-10-01T00:00:00.000Z', toISO: '2026-11-01T00:00:00.000Z',
    })
    assert.deepEqual(rangeFor({ addedWithin: 'two_months_ago' }, NOW), {
      fromISO: '2026-09-01T00:00:00.000Z', toISO: '2026-10-01T00:00:00.000Z',
    })
  })

  test('and they cross a year boundary correctly', () => {
    /*
     * The arithmetic that goes wrong by hand. In January, "two months ago" is
     * November of the year before — not month -1 of this one.
     */
    const jan = new Date('2027-01-15T10:00:00Z')
    assert.deepEqual(rangeFor({ addedWithin: 'last_month' }, jan), {
      fromISO: '2026-12-01T00:00:00.000Z', toISO: '2027-01-01T00:00:00.000Z',
    })
    assert.deepEqual(rangeFor({ addedWithin: 'two_months_ago' }, jan), {
      fromISO: '2026-11-01T00:00:00.000Z', toISO: '2026-12-01T00:00:00.000Z',
    })
  })

  test('the window is half-open, so the last day of a month is in it', () => {
    /*
     * A lead created at 23:59:59.400 on 31 October belongs to October. An
     * inclusive upper bound written as 23:59:59 loses it, which is a whole
     * day's intake missing from a monthly selection.
     */
    const lastMoment = lead({ created_at: '2026-10-31T23:59:59.400Z' })
    assert.equal(matchesFilter(lastMoment, { addedWithin: 'last_month' }, NOW), true)
    assert.equal(matchesFilter(lastMoment, { addedWithin: 'this_month' }, NOW), false)

    const firstMoment = lead({ created_at: '2026-11-01T00:00:00.000Z' })
    assert.equal(matchesFilter(firstMoment, { addedWithin: 'this_month' }, NOW), true)
    assert.equal(matchesFilter(firstMoment, { addedWithin: 'last_month' }, NOW), false)
  })

  test('the rolling windows are whole days, including today', () => {
    /*
     * Counted in calendar days to the end of today, not as a rolling 168
     * hours — which would cut off part of the day a lead arrived seven days
     * ago and quietly drop them from "last 7 days".
     */
    const { fromISO, toISO } = rangeFor({ addedWithin: 'last_7_days' }, NOW)
    assert.equal(toISO, '2026-11-06T00:00:00.000Z')
    assert.equal(fromISO, '2026-10-30T00:00:00.000Z')

    assert.equal(matchesFilter(lead({ created_at: '2026-10-30T00:30:00Z' }), { addedWithin: 'last_7_days' }, NOW), true)
    assert.equal(matchesFilter(lead({ created_at: '2026-10-29T23:30:00Z' }), { addedWithin: 'last_7_days' }, NOW), false)
    // Added an hour ago still counts.
    assert.equal(matchesFilter(lead({ created_at: '2026-11-05T13:30:00Z' }), { addedWithin: 'last_7_days' }, NOW), true)
  })

  test('30, 60 and 90 days are what they say', () => {
    for (const [preset, days] of [['last_30_days', 30], ['last_60_days', 60], ['last_90_days', 90]] as const) {
      const { fromISO, toISO } = rangeFor({ addedWithin: preset }, NOW)
      const span = (new Date(toISO!).getTime() - new Date(fromISO!).getTime()) / 86_400_000
      assert.equal(span, days, `${preset} spans ${span} days`)
    }
  })

  test('a custom range includes both of the dates given', () => {
    const { fromISO, toISO } = rangeFor(
      { addedWithin: 'custom', addedFrom: '2026-09-10', addedTo: '2026-09-12' }, NOW)
    assert.equal(fromISO, '2026-09-10T00:00:00.000Z')
    // The day after the end date, so the whole of the 12th is in.
    assert.equal(toISO, '2026-09-13T00:00:00.000Z')
    assert.equal(matchesFilter(lead({ created_at: '2026-09-12T22:00:00Z' }),
      { addedWithin: 'custom', addedFrom: '2026-09-10', addedTo: '2026-09-12' }, NOW), true)
  })

  test('a malformed custom date is ignored, not guessed at', () => {
    const { fromISO } = rangeFor({ addedWithin: 'custom', addedFrom: 'last tuesday' }, NOW)
    assert.equal(fromISO, null)
  })

  test('"any time" asks nothing about the date', () => {
    assert.deepEqual(rangeFor({ addedWithin: 'any' }, NOW), { fromISO: null, toISO: null })
    assert.deepEqual(rangeFor({}, NOW), { fromISO: null, toISO: null })
  })

  test('the date is the one the lead was CREATED', () => {
    // Not when it was last edited: a lead touched today did not arrive today,
    // and a month's intake is a fact about arrival.
    const filter: AudienceFilter = { addedWithin: 'this_month' }
    assert.equal(matchesFilter({ created_at: '2026-10-02T09:00:00Z' }, filter, NOW), false)
  })

  test('every preset on the screen is one the rule understands', () => {
    for (const p of DATE_PRESETS) {
      assert.doesNotThrow(() => rangeFor({ addedWithin: p.value, addedFrom: '2026-01-01', addedTo: '2026-01-02' }, NOW))
    }
  })

  test('the centre\'s clock is named once', () => {
    assert.equal(TIMEZONE, 'Africa/Accra')
  })
})

describe('the other conditions', () => {
  test('status, source, course, industry and owner each narrow the set', () => {
    assert.equal(matchesFilter(lead({ status: 'interested' }), { statuses: ['interested'] }, NOW), true)
    assert.equal(matchesFilter(lead({ status: 'new' }), { statuses: ['interested'] }, NOW), false)
    assert.equal(matchesFilter(lead({ source: 'facebook' }), { sources: ['facebook'] }, NOW), true)
    assert.equal(matchesFilter(lead({ course_interest: 'PHRi' }), { courses: ['PMP'] }, NOW), false)
    assert.equal(matchesFilter(lead({ industry: 'mining' }), { industries: ['mining'] }, NOW), true)
    assert.equal(matchesFilter(lead({ assigned_to: 'staff-2' }), { owners: ['staff-1'] }, NOW), false)
    assert.equal(matchesFilter(lead({ landing_source: 'Imported (IMPORT-20260916-0001)' }),
      { landingSources: ['Imported (IMPORT-20260916-0001)'] }, NOW), true)
  })

  test('several values in one condition are alternatives', () => {
    const f: AudienceFilter = { statuses: ['interested', 'follow_up'] }
    assert.equal(matchesFilter(lead({ status: 'interested' }), f, NOW), true)
    assert.equal(matchesFilter(lead({ status: 'follow_up' }), f, NOW), true)
    assert.equal(matchesFilter(lead({ status: 'lost' }), f, NOW), false)
  })

  test('and different conditions narrow each other', () => {
    /*
     * The combination the brief asks for: "added last month AND interested in
     * PMP". Each condition has to hold.
     */
    const f: AudienceFilter = { addedWithin: 'last_month', statuses: ['interested'], courses: ['PMP'] }
    assert.equal(matchesFilter(lead({ created_at: '2026-10-10T09:00:00Z', status: 'interested', course_interest: 'PMP' }), f, NOW), true)
    // Right month, wrong status.
    assert.equal(matchesFilter(lead({ created_at: '2026-10-10T09:00:00Z', status: 'new', course_interest: 'PMP' }), f, NOW), false)
    // Right status, wrong month.
    assert.equal(matchesFilter(lead({ created_at: '2026-11-02T09:00:00Z', status: 'interested', course_interest: 'PMP' }), f, NOW), false)
  })

  test('an empty filter selects everybody rather than nobody', () => {
    assert.equal(isEmptyFilter({}), true)
    assert.equal(isEmptyFilter({ addedWithin: 'any' }), true)
    assert.equal(isEmptyFilter({ statuses: [] }), true)
    assert.equal(isEmptyFilter({ statuses: ['new'] }), false)
    assert.equal(matchesFilter(lead(), {}, NOW), true)
  })

  test('the conditions are described in words a person can check', () => {
    const lines = describeFilter(
      { addedWithin: 'last_month', statuses: ['interested', 'follow_up'], courses: ['PMP'] })
    assert.deepEqual(lines, [
      'Added last month',
      'Status: interested or follow up',
      'Course of interest: PMP',
    ])
    assert.deepEqual(describeFilter({}), ['Every active lead'])
  })
})

describe('the message is the author\'s', () => {
  const session = {
    id: 'ses-1', title: 'PMP Information Session',
    scheduled_at: '2026-11-12T18:30:00Z', message: null, link: 'https://zoom.us/j/1',
  }

  test('only the recipient\'s own details are substituted', () => {
    const out = renderMessage('Hi {name}, join {title} on {when}: {link}', {
      session, lead: { full_name: 'Ama Mensah', phone: '0241234567' },
      origin: 'https://portal.cambridge.edu.gh', marketerCode: 'ruth-9f2a',
    })
    assert.match(out, /^Hi Ama, /)
    assert.match(out, /PMP Information Session/)
    assert.match(out, /https:\/\/portal\.cambridge\.edu\.gh\/j\/ses-1\/ruth-9f2a\?p=0241234567/)
    assert.ok(!out.includes('{'), 'a placeholder was left unreplaced')
  })

  test('everything else is left exactly as it was typed', () => {
    /*
     * A message that quietly grows a sentence nobody wrote is the behaviour
     * being removed, not a feature to keep.
     */
    const written = 'Come to our session.\n\nBring a friend — tea provided.'
    const out = renderMessage(written, { session, lead: {}, origin: 'https://x' })
    assert.equal(out, written)
  })

  test('an empty message is NOT replaced with a default', () => {
    // The campaign cannot be created without one, so an empty message here
    // means something upstream went wrong — and sending a sentence nobody
    // wrote would hide it.
    assert.equal(renderMessage('', { session, lead: {}, origin: 'https://x' }), '')
    assert.equal(renderMessage(null, { session, lead: {}, origin: 'https://x' }), '')
    assert.equal(renderMessage('   ', { session, lead: {}, origin: 'https://x' }), '')
  })

  test('a recipient with no name is addressed, not left blank', () => {
    const out = renderMessage('Hi {name}.', { session, lead: {}, origin: 'https://x' })
    assert.equal(out, 'Hi there.')
  })

  test('every placeholder the screen offers is one the renderer knows', () => {
    const text = PLACEHOLDERS.map(p => p.token).join(' ')
    const out = renderMessage(text, {
      session, lead: { full_name: 'Ama' }, origin: 'https://x',
    })
    assert.ok(!out.includes('{'), `an offered placeholder is not substituted: ${out}`)
  })

  test('the session time is shown in Accra', () => {
    assert.match(sessionWhen('2026-11-12T18:30:00Z'), /12 Nov 2026/)
    assert.equal(sessionWhen(null), '')
    assert.equal(sessionWhen('not a date'), '')
  })
})

describe('what a message costs to send', () => {
  test('160 characters is one text, 161 is two', () => {
    assert.deepEqual(countSegments('a'.repeat(160)), { characters: 160, segments: 1, encoding: 'GSM-7', perSegment: 160 })
    const two = countSegments('a'.repeat(161))
    assert.equal(two.segments, 2)
    /*
     * 153, not 160, once it splits: a concatenated message spends seven
     * characters a part on the header that reassembles it. Charging is per
     * part, so three characters over doubles the cost of a campaign.
     */
    assert.equal(two.perSegment, 153)
  })

  test('a special character drops the limit to 70', () => {
    // An emoji or a curly quote forces UCS-2 on the whole message.
    const unicode = countSegments('Hello “friend”')
    assert.equal(unicode.encoding, 'UCS-2')
    assert.equal(unicode.perSegment, 70)
    assert.equal(countSegments('x'.repeat(71) + '“').segments, 2)
  })

  test('an empty message costs nothing', () => {
    assert.equal(countSegments('').segments, 0)
  })

  test('a newline and the GSM punctuation stay in the cheap alphabet', () => {
    const plain = countSegments('Hi Ama,\nJoin us at 18:30 (free). Cost: GHS 0 — see you!')
    assert.equal(plain.encoding, 'UCS-2')  // the em dash is not GSM-7
    assert.equal(countSegments('Hi Ama,\nJoin us at 18:30 (free). Cost: GHS 0. See you!').encoding, 'GSM-7')
  })
})

/* ─────────────────────────────────────────────────────────────────────────── */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the audience is counted and kept by the server', () => {
  const query = codeOf('lib/leads/audienceQuery.ts')
  const route = codeOf('app/api/info-sessions/route.ts')
  const page = codeOf('app/(portal)/pm/info-sessions/page.tsx')

  test('the count comes from the database, not a loaded page of leads', () => {
    assert.match(page, /\/api\/info-sessions\/audience/)
    assert.match(query, /from\('leads'\)\.select\(SELECT\)/)
  })

  test('each condition narrows the query', () => {
    assert.match(query, /if \(fromISO\) q = q\.gte\('created_at', fromISO\)/)
    assert.match(query, /if \(toISO\) q = q\.lt\('created_at', toISO\)/)
    assert.match(query, /if \(values\.length\) q = q\.in\(column, values\)/)
  })

  test('nobody is enrolled twice, however the filters overlap', () => {
    assert.match(query, /const seen = new Set<string>\(\)/)
    assert.match(query, /if \(seen\.has\(lead\.id\)\) continue/)
  })

  test('leads without a usable number are separated, not dropped', () => {
    /*
     * The branch, not the words in it. `if (false) excluded.push(…)` leaves
     * the reason string in the file and reports nobody.
     */
    assert.match(query, /if \(normaliseRecipient\(lead\.phone \|\| ''\)\) sendable\.push\(lead\)/)
    assert.match(query, /else \{\s*\n\s*excluded\.push\(\{/)
    assert.match(query, /reason: lead\.phone \? 'The number is not a Ghanaian mobile' : 'No phone number on the record'/)
  })

  test('the criteria are saved with the campaign, so history cannot drift', () => {
    /*
     * A lead edited next week must not change who a campaign sent to last
     * week, and the history has to say what was ASKED for as well as who
     * answered.
     */
    assert.match(route, /audience_filter: audienceFilter/)
    assert.match(route, /audience_summary: \{/)
    assert.match(route, /conditions: describeFilter\(audienceFilter\)/)
  })

  test('and the campaign enrols from the saved criteria, not the live filter', () => {
    const campaign = codeOf('lib/infoSessionCampaign.ts')
    assert.match(campaign, /filter\?: AudienceFilter \| null/)
    assert.match(campaign, /resolveAudience\(filter \|\| legacyFilter\(audience\)\)/)
  })

  test('a campaign cannot be created with no message', () => {
    /*
     * The guard, not the sentence. `if (false)` keeps the refusal's words and
     * refuses nothing.
     */
    assert.match(route, /const text = String\(message \?\? ''\)\.trim\(\)/)
    assert.match(route, /if \(!text\) \{/)
    assert.match(route, /Write the message you want to send\. There is no default/)
    assert.match(page, /if \(!form\.message\.trim\(\)\) \{/)
  })

  test('nor with a message it cannot store', () => {
    // Without the column it would send the text that used to be hardcoded,
    // which is not what the author wrote and worse than refusing.
    assert.match(route, /columnExists\('info_sessions', 'message'\)/)
    assert.match(route, /migration 0030/)
  })

  test('nor with nobody to send it to', () => {
    assert.match(route, /No leads match that selection/)
    assert.match(route, /none of them has a usable phone number/)
  })

  test('the message the author wrote is what each recipient is sent', () => {
    const campaign = codeOf('lib/infoSessionCampaign.ts')
    assert.match(campaign, /message: renderMessage\(messageForSession\(session\)\.text/)
    assert.match(campaign, /const msg = \(r\.message \|\| ''\)\.trim\(\)/)
    assert.match(campaign, /This campaign has no message, so nothing was sent/)
  })

  test('the old invitation is no longer written into the sending code', () => {
    const campaign = codeOf('lib/infoSessionCampaign.ts')
    assert.ok(!/you're invited to Cambridge Center of Excellence/i.test(campaign),
      'the built-in invitation text is still in the sender')
  })

  test('but a campaign created before authors could write one keeps its words', () => {
    /*
     * One such campaign was part-way through sending when this shipped. Left
     * alone it would have resumed and marked every remaining recipient failed
     * for having no message — true, and useless to everybody.
     *
     * It is not a default: a campaign created from now on cannot exist
     * without a message, and an EMPTY one is still a fault.
     */
    assert.equal(messageForSession({ message: 'My own words' }).text, 'My own words')
    assert.equal(messageForSession({ message: 'My own words' }).legacy, false)

    const legacy = messageForSession({ message: null })
    assert.equal(legacy.legacy, true)
    assert.equal(legacy.text, LEGACY_INVITATION)
    assert.match(legacy.text, /\{name\}/)
    assert.match(legacy.text, /\{link\}/)

    // Whitespace is not a message either.
    assert.equal(messageForSession({ message: '   ' }).legacy, true)
    assert.equal(messageForSession(null).legacy, true)
  })

  test('and the route still refuses a NEW campaign with no message', () => {
    assert.match(route, /if \(!text\) \{/)
    assert.match(route, /There is no default/)
  })
})

describe('who received it, and what they received', () => {
  const recipients = codeOf('app/api/info-sessions/recipients/route.ts')
  const dialog = codeOf('app/(portal)/pm/info-sessions/RecipientsDialog.tsx')
  const page = codeOf('app/(portal)/pm/info-sessions/page.tsx')

  test('the list is the campaign\'s own ledger, not a lead search', () => {
    /*
     * Clicking "250 recipients" has to open those 250 records. A filtered
     * list of all leads answers a different question, and answers it
     * differently tomorrow.
     */
    assert.match(recipients, /from\('info_session_recipients'\)/)
    assert.match(recipients, /\.eq\('session_id', sessionId\)/)
  })

  test('each row carries the exact message that person was sent', () => {
    assert.match(recipients, /message: r\.message/)
    assert.match(dialog, /The message this person was sent/)
  })

  test('with the status, the reason and when it was processed', () => {
    for (const field of ['status: r.status', 'reason: r.last_error', 'sentAt: r.sent_at', 'attempts: r.attempts']) {
      assert.ok(recipients.includes(field), `the recipient record omits ${field}`)
    }
  })

  test('and it can be searched and narrowed by state', () => {
    assert.match(recipients, /url\.searchParams\.get\('status'\)/)
    assert.match(recipients, /ilike\('phone'/)
    assert.match(dialog, /Search by name or phone number/)
  })

  test('the figures on the screen open the matching records', () => {
    assert.match(page, /setInspect\(\{ id: s\.id, title: s\.title \}\)/)
    assert.match(page, /status: 'failed'/)
    assert.match(page, /status: 'unreachable'/)
  })

  test('the technical state names never reach the reader', () => {
    // "claimed" and "pending" mean nothing to an administrator.
    assert.match(dialog, /sent: 'Submitted'/)
    assert.match(dialog, /claimed: 'Processing'/)
    assert.match(dialog, /pending: 'Waiting'/)
  })

  test('a dialog can be left without doing anything', () => {
    assert.match(dialog, /Back to the list/)
    assert.match(dialog, /onClick=\{onClose\}>Close/)
  })
})

describe('who drove attendance', () => {
  const attendance = codeOf('app/api/info-sessions/attendance/route.ts')
  const page = codeOf('app/(portal)/pm/info-sessions/page.tsx')

  test('a person is counted once, however often they opened the link', () => {
    /*
     * It counted join ROWS: thirty-five rows from twenty-one leads reported
     * as thirty-five. A heading saying "26 joined" when twenty-one people
     * joined is a number management will plan against.
     */
    assert.match(attendance, /const attendees = new Map<string, Map<string/)
    assert.match(attendance, /if \(!attendees\.get\(sid\)!\.has\(key\)\)/)
    assert.match(attendance, /attended = list\.length/)
  })

  test('the three relationships are kept apart', () => {
    /*
     * Whose link was clicked is who INVITED them — not who found them, and
     * not who is responsible for them. On this data most leads were imported
     * and assigned afterwards, so those are usually different people.
     */
    assert.match(attendance, /bySource: tally/)
    assert.match(attendance, /byOwner: tally/)
    assert.match(attendance, /byInviter: tally/)
    assert.match(page, /Where they came from/)
    assert.match(page, /Who is responsible/)
    assert.match(page, /Whose link they used/)
  })

  test('attribution that is not recorded says so', () => {
    assert.match(attendance, /label: key === '__unknown__' \? 'Not recorded'/)
    assert.ok(!/'Unattributed'|'Probably'/.test(attendance))
  })

  test('the rate is over the people actually messaged', () => {
    // Not over everybody in the database, which would make any campaign look
    // like a failure.
    assert.match(attendance, /from\('info_session_recipients'\)/)
    assert.match(attendance, /attendanceRate: invited \? Math\.round\(\(attended \/ invited\) \* 100\) : null/)
  })

  test('and the screen explains what the reader is looking at', () => {
    assert.match(page, /Which lead sources and staff members contributed/)
    assert.match(page, /Each person is counted once/)
    assert.match(attendance, /explanation:/)
  })
})

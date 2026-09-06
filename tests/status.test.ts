import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { describeStatus, statusLabel, knownStatuses } from '../lib/ui/status.ts'
import { classModeLabel } from '../lib/classMode.ts'

/**
 * The status vocabulary.
 *
 * Labels used to be written per screen. That is how the same student's
 * registration came to read "Online" on one screen, "Virtual" on another and
 * "physical" on the batch — and how a physical admission letter went to
 * somebody who had enrolled online.
 *
 * These tests pin two things: that every value the production database
 * actually holds has a deliberate label, and that class mode has exactly one
 * name per mode across the whole product.
 */

/*
 * Read from production on 6 September 2026, not invented:
 *
 *   SELECT status, count(*) FROM leads GROUP BY 1;
 *   SELECT delivery, count(*) FROM applications GROUP BY 1;
 *   SELECT status, count(*) FROM student_fees GROUP BY 1;
 *   SELECT payment_status, count(*) FROM applications GROUP BY 1;
 *   SELECT class_type, count(*) FROM batches GROUP BY 1;
 *   SELECT status, count(*) FROM admissions GROUP BY 1;
 *   SELECT status, count(*) FROM sms_logs GROUP BY 1;
 */
const LIVE_VALUES: Array<[Parameters<typeof describeStatus>[0], string[]]> = [
  ['lead', ['new', 'contacted', 'follow_up', 'zuku', 'interested',
            'registered', 'ready_to_join', 'next_session', 'conflicts', 'not_interested']],
  ['payment', ['owing', 'partial', 'paid', 'pending']],
  ['feePayment', ['pending', 'verified', 'rejected']],
  ['sms', ['sent', 'failed', 'queued', 'sending', 'retrying']],
  ['importRow', ['assigned', 'unassigned', 'duplicate', 'invalid', 'failed']],
  ['admission', ['admitted']],
]

describe('every value the database holds has a deliberate label', () => {
  for (const [domain, values] of LIVE_VALUES) {
    for (const value of values) {
      test(`${domain}/${value}`, () => {
        const d = describeStatus(domain, value)
        assert.ok(d.label, 'must have a label')
        // The fallback humaniser would return the enum with underscores
        // swapped for spaces. A real entry never looks like that.
        assert.ok(!/_/.test(d.label), `"${d.label}" still reads like a database value`)
        assert.notEqual(d.label, 'Unknown')
      })
    }
  }
})

describe('class mode has exactly one name per mode', () => {
  test('every spelling the system has ever stored resolves to the same label', () => {
    // These are the spellings lib/classMode.ts accepts. If any of them
    // produced a different label, that is the drift that put a physical
    // letter in an online student's hands.
    const online = ['online', 'virtual', 'Virtual Class', 'remote', 'zoom', 'e_learning']
    const inPerson = ['in_person', 'physical', 'In Person', 'onsite', 'campus', 'face to face']

    const onlineLabels = new Set(online.map(v => statusLabel('classMode', v)))
    const inPersonLabels = new Set(inPerson.map(v => statusLabel('classMode', v)))

    assert.equal(onlineLabels.size, 1, `online spellings produced ${[...onlineLabels]}`)
    assert.equal(inPersonLabels.size, 1, `in-person spellings produced ${[...inPersonLabels]}`)
    assert.notDeepEqual([...onlineLabels], [...inPersonLabels])
  })

  test('the label is the one lib/classMode.ts defines, not a second opinion', () => {
    assert.equal(statusLabel('classMode', 'online'), classModeLabel('online'))
    assert.equal(statusLabel('classMode', 'physical'), classModeLabel('in_person'))
  })

  test('a missing mode is shown as missing, never defaulted', () => {
    // Defaulting here is precisely how the wrong admission letter is chosen.
    for (const absent of [null, undefined, '', 'somethingelse']) {
      const d = describeStatus('classMode', absent)
      assert.equal(d.label, 'Mode not set')
      assert.equal(d.tone, 'warning')
    }
  })
})

describe('the fallback is honest', () => {
  test('an unknown value is made readable without claiming a meaning', () => {
    const d = describeStatus('lead', 'awaiting_visa')
    assert.equal(d.label, 'Awaiting visa')
    assert.equal(d.tone, 'neutral', 'no tone is a claim about something we do not know')
    assert.equal(d.hint, undefined)
  })

  test('an absent value never renders as a blank badge', () => {
    for (const empty of [null, undefined, '', '   ']) {
      assert.equal(describeStatus('lead', empty).label, 'Unknown')
    }
  })
})

describe('filters can be built from the vocabulary', () => {
  test('knownStatuses returns real values, so a filter cannot list a status that does not exist', () => {
    const sms = knownStatuses('sms')
    assert.deepEqual(sms.sort(), ['failed', 'queued', 'retrying', 'sending', 'sent'])
    for (const s of sms) assert.notEqual(describeStatus('sms', s).label, 'Unknown')
  })
})

describe('tone carries meaning consistently', () => {
  test('a state needing action is never shown as success', () => {
    for (const [domain, value] of [
      ['lead', 'follow_up'], ['payment', 'owing'], ['sms', 'failed'],
      ['importRow', 'invalid'], ['feePayment', 'pending'],
    ] as const) {
      const tone = describeStatus(domain, value).tone
      assert.notEqual(tone, 'success', `${domain}/${value} must not read as resolved`)
    }
  })

  test('a settled state is never shown as a problem', () => {
    for (const [domain, value] of [
      ['lead', 'registered'], ['payment', 'paid'], ['sms', 'sent'],
      ['importRow', 'assigned'], ['feePayment', 'verified'], ['admission', 'admitted'],
    ] as const) {
      assert.equal(describeStatus(domain, value).tone, 'success')
    }
  })
})

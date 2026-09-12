import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  capabilityOf, matchProgramme, nextCohort, describeProgramme, type Programme,
} from '../lib/chatbot/programmeRules.ts'

/**
 * THE ZERO-HALLUCINATION RULE.
 *
 * Section 8 of the brief: the model is not the source of truth, and a fact the
 * record does not hold must never appear in a message. This is the half of
 * that which can be proved without calling a model — and it is the half that
 * decides, because the prompt can only forbid what the context does not
 * supply.
 */

function programme(over: Partial<Programme> = {}): Programme {
  return {
    id: 'p1', name: 'Airbnb Management Masterclass', code: 'AIRBNB',
    description: null, duration: null,
    feeInPerson: null, feeOnline: null, registrationFee: null,
    brochureUrl: null, cohorts: [],
    ...over,
  }
}

describe('what may be offered comes from the record', () => {
  test('a programme with nothing on it can offer nothing', () => {
    const cap = capabilityOf(programme(), null)
    assert.deepEqual(cap, {
      canQuoteFee: false, canShowSchedule: false, canSendBrochure: false, canRegister: false,
    })
  })

  test('a fee makes a fee quotable — and only a real one', () => {
    assert.equal(capabilityOf(programme({ feeInPerson: 3950 }), null).canQuoteFee, true)
    assert.equal(capabilityOf(programme({ feeOnline: 2950 }), null).canQuoteFee, true)
    assert.equal(capabilityOf(programme({ feeInPerson: null }), null).canQuoteFee, false)
  })

  test('a brochure URL makes a brochure sendable', () => {
    assert.equal(capabilityOf(programme({ brochureUrl: 'https://x/y.pdf' }), null).canSendBrochure, true)
    assert.equal(capabilityOf(programme(), null).canSendBrochure, false)
  })

  test('registration needs a link to send them to', () => {
    assert.equal(capabilityOf(programme(), 'https://x/apply/ABC').canRegister, true)
    assert.equal(capabilityOf(programme(), null).canRegister, false,
      'registration was offered with nowhere to send them')
  })
})

describe('a missing fact is stated as missing, not omitted', () => {
  /*
   * Omitting it leaves the model to notice the gap. Naming it tells the model
   * it does not know, which is the difference between silence and invention.
   */
  test('no fee is spelled out as not recorded', () => {
    const p = programme()
    const text = describeProgramme(p, capabilityOf(p, null))
    assert.match(text, /Fee: NOT RECORDED/)
    assert.match(text, /Do not state one, do not estimate/)
    assert.ok(!/GHS/.test(text), 'a currency figure appeared for a programme with no fee')
  })

  test('no cohort is spelled out as none scheduled', () => {
    const p = programme()
    const text = describeProgramme(p, capabilityOf(p, null))
    assert.match(text, /Cohorts: NONE SCHEDULED/)
    assert.match(text, /Do not name a date/)
  })

  test('no brochure is spelled out, so it is not offered', () => {
    const p = programme()
    const text = describeProgramme(p, capabilityOf(p, null))
    assert.match(text, /Brochure: NOT available\. Do not offer one\./)
  })

  test('a real fee IS stated, in the centre’s own format', () => {
    const p = programme({ feeInPerson: 3950, feeOnline: 2950, registrationFee: 200 })
    const text = describeProgramme(p, capabilityOf(p, null))
    assert.match(text, /GHS 3,950 in person/)
    assert.match(text, /GHS 2,950 online/)
    assert.match(text, /Registration fee: GHS 200/)
    assert.ok(!/NOT RECORDED/.test(text))
  })

  test('a real cohort IS stated, with its real date', () => {
    const p = programme({
      cohorts: [{
        name: 'Oct', startDate: '2026-10-12', startDateText: '12 October 2026',
        schedule: 'Sat, 9am-1pm', venue: null, online: true, running: false,
      }],
    })
    const text = describeProgramme(p, capabilityOf(p, null))
    assert.match(text, /starts 12 October 2026/)
    assert.ok(!/NONE SCHEDULED/.test(text))
  })

  test('a cohort with no date does not acquire one', () => {
    const p = programme({
      cohorts: [{
        name: 'TBC', startDate: null, startDateText: null,
        schedule: null, venue: 'Accra', online: false, running: false,
      }],
    })
    const text = describeProgramme(p, capabilityOf(p, null))
    assert.match(text, /start date not set/)
  })
})

describe('the right programme, or none', () => {
  const list = [
    programme({ id: '1', name: 'Airbnb Management Masterclass', code: 'AIRBNB' }),
    programme({ id: '2', name: 'Projects Management Professional', code: 'PMP' }),
    programme({ id: '3', name: 'Professional in Human Resources', code: 'PHRi' }),
    programme({ id: '4', name: 'Senior Professional in Human Resources', code: 'SPHR' }),
  ]

  test('the code, exactly', () => {
    assert.equal(matchProgramme(list, 'PMP')?.id, '2')
    assert.equal(matchProgramme(list, 'pmp')?.id, '2')
  })

  test('the code as a whole word, never inside another', () => {
    assert.equal(matchProgramme(list, 'I want PMP training')?.id, '2')
    // SPHR must not be found inside PHRi, nor PHRi inside SPHR.
    const phr = matchProgramme(list, 'tell me about PHRi')
    assert.equal(phr?.id, '3')
  })

  test('a distinctive word from the name', () => {
    assert.equal(matchProgramme(list, "I'm interested in the Airbnb course")?.id, '1')
  })

  test('a word two programmes share matches neither', () => {
    /*
     * "human resources" is both PHRi and SPHR. Recommending one of them with
     * confident detail is worse than asking which they mean.
     */
    assert.equal(matchProgramme(list, 'I want the human resources one'), null)
  })

  test('a generic word matches nothing', () => {
    assert.equal(matchProgramme(list, 'I want a course'), null)
    assert.equal(matchProgramme(list, 'training please'), null)
  })

  test('nothing said matches nothing', () => {
    assert.equal(matchProgramme(list, ''), null)
    assert.equal(matchProgramme(list, null), null)
    assert.equal(matchProgramme([], 'PMP'), null)
  })
})

describe('the next cohort is the next one, not just the first row', () => {
  test('an upcoming cohort beats one already running', () => {
    const p = programme({
      cohorts: [
        { name: 'A', startDate: '2026-01-01', startDateText: '1 January 2026', schedule: null, venue: null, online: false, running: true },
        { name: 'B', startDate: '2026-10-12', startDateText: '12 October 2026', schedule: null, venue: null, online: false, running: false },
      ],
    })
    assert.equal(nextCohort(p)?.name, 'B')
  })

  test('with only a running cohort, that is the answer', () => {
    const p = programme({
      cohorts: [{ name: 'A', startDate: '2026-01-01', startDateText: '1 January 2026', schedule: null, venue: null, online: false, running: true }],
    })
    assert.equal(nextCohort(p)?.name, 'A')
  })

  test('no cohorts means no cohort', () => {
    assert.equal(nextCohort(programme()), null)
  })
})

describe('the programme read names only columns this repository confirms', () => {
  /*
   * The loader this replaced selected `courses.price`. The Course interface in
   * types/index.ts has no such field and the admin screen writes `course_fee`
   * — and PostgREST fails the WHOLE select on a missing column, so if `price`
   * is not there the assistant has had no fees in front of it at all while
   * being told to quote fees "only from the facts below".
   */
  const src = readFileSync('lib/chatbot/programme.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  test('it does not select a column the Course type lacks', () => {
    const types = readFileSync('types/index.ts', 'utf8')
    const course = types.slice(types.indexOf('export interface Course'), types.indexOf('export interface Batch'))
    assert.ok(!/\bprice\b/.test(course), 'the Course type gained a price field; revisit this')
    assert.ok(!/select\([^)]*\bprice\b/.test(src),
      'the programme read selects `price`, which this repository cannot confirm exists — ' +
      'and a missing column fails the entire select')
  })

  test('it selects the fee columns the admin screen actually writes', () => {
    for (const col of ['course_fee', 'course_fee_online', 'registration_fee', 'brochure_url']) {
      assert.ok(src.includes(col), `the programme read does not ask for ${col}`)
    }
  })

  test('and falls back rather than losing every fact', () => {
    assert.match(src, /COURSE_MINIMAL/,
      'a schema that differs from this repository would leave the assistant with nothing')
  })
})

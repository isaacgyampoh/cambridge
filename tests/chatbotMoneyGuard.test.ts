import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { amountsIn, allowedAmounts, unsupportedAmounts } from '../lib/chatbot/moneyGuard.ts'

/**
 * NO FEE LEAVES THIS SYSTEM THAT THE SYSTEM DOES NOT HOLD.
 *
 * Every other guard in the assistant asks whether it HAS the facts:
 * unreadable programmes, unreadable knowledge, no facts at all. None asked
 * whether the sentence it produced matched them. The system prompt requests
 * that, and a prompt is a request — a model holding "PMP, GHS 3,950" will
 * sometimes write 4,000, by rounding, by merging two programmes, or by
 * completing the shape of the question it was asked.
 *
 * That sentence goes to a stranger on WhatsApp, in a marketer's name. The
 * centre is then left either honouring a price it never set, or telling
 * somebody the fee went up after they had decided to enrol.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const PMP = { feeInPerson: 3950, feeOnline: 2950, registrationFee: 200 }

describe('an amount is recognised however it is written', () => {
  test('the spellings a reply actually uses', () => {
    for (const written of [
      'It is GHS 3,950 for the in-person cohort.',
      'The fee is GHS3950.',
      'GH₵ 3,950 covers everything.',
      'It costs ₵3,950.',
      'The fee is 3,950 cedis.',
      'GHC 3,950.00 in total.',
    ]) {
      assert.deepEqual(amountsIn(written), ['3950'], `not recognised: ${written}`)
    }
  })

  test('several amounts in one sentence', () => {
    const got = amountsIn('GHS 3,950 in person or GHS 2,950 online.')
    assert.deepEqual(got, ['3950', '2950'])
  })

  test('and nothing at all when no money is mentioned', () => {
    assert.deepEqual(amountsIn('The class runs from 9 to 5 for 6 weeks.'), [])
  })
})

describe('a recorded fee passes', () => {
  const allowed = allowedAmounts([PMP])

  test('the in-person fee', () => {
    assert.deepEqual(unsupportedAmounts('PMP is GHS 3,950 in person.', allowed), [])
  })

  test('the online fee', () => {
    assert.deepEqual(unsupportedAmounts('Online it is GHS 2,950.', allowed), [])
  })

  test('the registration fee', () => {
    assert.deepEqual(unsupportedAmounts('Registration is GHS 200.', allowed), [])
  })

  test('however the reply happens to punctuate it', () => {
    assert.deepEqual(unsupportedAmounts('It is GHS3950.00 altogether.', allowed), [])
  })

  test('and a price the knowledge base records is a fact too', () => {
    /*
     * An FAQ quoting an exam fee or a resit charge was put there by the
     * centre on purpose. Repeating it is correct, and a guard that only knew
     * about programme rows would hand those conversations to a person.
     */
    const withKb = allowedAmounts([PMP], 'The PMI exam fee is GHS 2,300 and a resit is GHS 1,150.')
    assert.deepEqual(unsupportedAmounts('The exam itself is GHS 2,300.', withKb), [])
  })
})

describe('an invented fee does not', () => {
  const allowed = allowedAmounts([PMP])

  test('a rounded figure is caught', () => {
    // The single likeliest way a model gets this wrong.
    assert.deepEqual(unsupportedAmounts('PMP is about GHS 4,000.', allowed), ['4000'])
  })

  test('a number from nowhere is caught', () => {
    assert.deepEqual(unsupportedAmounts('That one is GHS 7,500.', allowed), ['7500'])
  })

  test('a real fee beside an invented one still fails', () => {
    // The dangerous shape: it looks authoritative because half of it is right.
    const got = unsupportedAmounts('GHS 3,950 in person, or GHS 3,100 online.', allowed)
    assert.deepEqual(got, ['3100'])
  })

  test('each invented amount is reported once', () => {
    const got = unsupportedAmounts('GHS 4,000 — yes, GHS 4,000.', allowed)
    assert.deepEqual(got, ['4000'])
  })
})

describe('it does not fire on things a correct reply says', () => {
  const allowed = allowedAmounts([PMP])

  /*
   * This is the half that decides whether the guard is safe to leave on. A
   * check that hands every second conversation to a person gets switched off,
   * and then it protects nothing.
   */
  test('times, durations and years are left alone', () => {
    for (const innocent of [
      'Classes run 9 to 5 on Saturdays.',
      'It is 6 weeks long.',
      'The next cohort starts in March 2026.',
      'There are 35 contact hours.',
      'Call me on 0241234567.',
    ]) {
      assert.deepEqual(unsupportedAmounts(innocent, allowed), [], `fired on: ${innocent}`)
    }
  })

  test('a reply that mentions no money is never questioned', () => {
    assert.deepEqual(unsupportedAmounts('Which programme were you thinking about?', allowed), [])
  })

  test('a bare number next to a currency word elsewhere is not swept up', () => {
    // "3,950" is marked; "6" is not, and must not inherit the marker.
    assert.deepEqual(unsupportedAmounts('GHS 3,950 for the 6 week course.', allowed), [])
  })
})

describe('the assistant refuses to send it', () => {
  const src = codeOf('lib/chatbot/index.ts')

  test('the reply is checked against what is on file', () => {
    assert.match(src, /const known = allowedAmounts\(/)
    assert.match(src, /const invented = unsupportedAmounts\(text, known\)/)
  })

  test('and an unsupported amount goes to a person instead of to the lead', () => {
    assert.match(src, /if \(invented\.length\)[\s\S]{0,600}handoff: 'assistant_unsure'/,
      'A reply quoting a price nobody recorded must not be sent.')
    assert.match(src, /skipped: 'unsupported-amount'/,
      'It must be distinguishable from the model being absent or failing.')
  })

  test('the check runs on the formatted text that would actually be sent', () => {
    const format = src.indexOf('const text = forWhatsApp(raw)')
    const check = src.indexOf('const invented =')
    assert.ok(format > 0 && format < check,
      'Checking the raw model output would miss anything formatting introduces.')
  })

  test('every programme in play is counted as a source of truth', () => {
    /*
     * Not just the matched one. A reply comparing two programmes quotes both,
     * and a guard that only knew the matched programme would refuse a
     * perfectly correct comparison.
     */
    assert.match(src, /ctx\.programme \? \[ctx\.programme, \.\.\.ctx\.allProgrammes\] : ctx\.allProgrammes/)
    assert.match(src, /knowledge\.text/,
      'Prices recorded in the knowledge base are facts as much as programme rows.')
  })
})

describe('and staff can see it happened', () => {
  const webhook = codeOf('app/api/webhooks/whatsapp/route.ts')
  const log = codeOf('app/(portal)/admin/webhook-log/page.tsx')

  test('a withheld reply is recorded where people look', () => {
    /*
     * A console line is not a record. When the assistant reaches for a price
     * that is not on file it is almost always because a course row has no fee
     * recorded — which is fixable on the Courses screen by whoever sees this,
     * and invisible to them if it only ever reaches a server log.
     */
    assert.match(webhook, /answer\.skipped === 'unsupported-amount'/)
    assert.match(webhook, /wrong_fee_withheld/)
  })

  test('and it reads as something a person can act on', () => {
    assert.match(log, /wrong_fee_withheld: 'Wrong fee — not sent'/)
    assert.match(log, /wrong_fee_withheld: 'danger'/)
  })

  test('the line diagnostics are labelled too, not left as raw keys', () => {
    // These are written by the webhook; an unlabelled outcome renders as the
    // database string, which tells a receptionist nothing.
    for (const outcome of ['unknown_line', 'line_lookup_failed']) {
      assert.ok(log.includes(`${outcome}:`), `${outcome} has no label on the activity screen`)
    }
  })
})

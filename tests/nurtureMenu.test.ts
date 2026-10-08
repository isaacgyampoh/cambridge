import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { actionsFor, renderActions, matchAction } from '../lib/chatbot/actions.ts'

const ALL = {
  canQuoteFee: true, canShowSchedule: true, canSendBrochure: true, canRegister: true,
} as never

function code(path: string) {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * The nurturing sequence Isaac drew: a message, a numbered menu, and the
 * option taken drops off the next one.
 */

describe('the menu reads as the drawing does', () => {
  test('the labels are the ones asked for', () => {
    const labels = actionsFor({ capability: ALL, stage: 'NEW' }).map(a => a.label)
    assert.ok(labels.includes('Download brochure'), labels.join(' | '))
    assert.ok(labels.includes('Apply Online'), labels.join(' | '))
    assert.ok(labels.includes('Call a Supervisor'), labels.join(' | '))
  })

  test('"Study the Schedule" appears once the conversation is past discovery', () => {
    const labels = actionsFor({ capability: ALL, stage: 'PROGRAMME_INTEREST' }).map(a => a.label)
    assert.ok(labels.includes('Study the Schedule'), labels.join(' | '))
  })

  test('it renders as a numbered list', () => {
    const text = renderActions(actionsFor({ capability: ALL, stage: 'NEW' }))
    assert.match(text, /\n1\. /)
    assert.match(text, /\n2\. /)
    assert.match(text, /\n3\. /)
  })

  test('taking one drops it and brings another forward', () => {
    // Exactly the two screens in the PDF: "Apply Online" is chosen, and the
    // next menu no longer offers it.
    const first = actionsFor({ capability: ALL, stage: 'PROGRAMME_INTEREST' })
    assert.ok(first.some(a => a.id === 'register'))

    const second = actionsFor({ capability: ALL, stage: 'PROGRAMME_INTEREST', taken: ['register'] })
    assert.ok(!second.some(a => a.id === 'register'), 'the chosen option must drop off')
    assert.ok(second.length >= 2, 'and the menu must not collapse')
  })

  test('nothing is offered that cannot be delivered', () => {
    const none = { canQuoteFee: false, canShowSchedule: false, canSendBrochure: false, canRegister: false } as never
    const ids = actionsFor({ capability: none, stage: 'NEW' }).map(a => a.id)
    assert.deepEqual(ids, ['speak_to_human'],
      'with nothing on the programme record, only a person is left')
  })
})

describe('a reply still resolves after the relabel', () => {
  const offered = actionsFor({ capability: ALL, stage: 'PROGRAMME_INTEREST', humanName: 'Ruth Mensah' })

  test('a number works', () => {
    assert.equal(matchAction('2', offered)?.id, offered[1].id)
    assert.equal(matchAction('2.', offered)?.id, offered[1].id)
    assert.equal(matchAction(' #3 ', offered)?.id, offered[2].id)
  })

  test('"brochure" still works, though the label now starts with "Download"', () => {
    /*
     * The regression this guards: matching used to take the first word after
     * stripping "send the", so relabelling to "Download brochure" would have
     * made the word "download" the only one that matched — and "brochure" is
     * what people actually type.
     */
    const b = offered.find(a => a.id === 'brochure')
    if (b) {
      assert.equal(matchAction('brochure', offered)?.id, 'brochure')
      assert.equal(matchAction('download', offered)?.id, 'brochure')
    }
  })

  test('the full label works', () => {
    for (const a of offered) {
      assert.equal(matchAction(a.label, offered)?.id, a.id, `failed on ${a.label}`)
    }
  })

  test('a question about delivery mode does not register the lead', () => {
    // "Apply Online" contributes the word "online", which is also how someone
    // asks whether the class is online. A question is a question.
    assert.equal(matchAction('is the class online?', offered), null)
    assert.equal(matchAction('can I do this online or do I come to campus', offered), null)
  })

  test('a sentence is left to the assistant', () => {
    assert.equal(matchAction('I would like to know more about the schedule please', offered), null)
  })

  test('nothing offered means nothing matched', () => {
    assert.equal(matchAction('1', []), null)
    assert.equal(matchAction('', offered), null)
  })
})

describe('the nurturing sequence carries the menu', () => {
  const s = code('app/api/sequences/run/route.ts')

  test('a WhatsApp step appends it', () => {
    assert.match(s, /renderActions\(actionsFor\(/, 'the drip must offer the options')
    assert.match(s, /sendWhatsAppText\(lead\.phone, msg \+ menu/,
      'and send them with the message')
  })

  test('an SMS step does not', () => {
    // Each option costs characters, and an SMS cannot be answered on the
    // WhatsApp line that would resolve the reply.
    const sms = s.slice(s.indexOf("step.channel === 'sms'"), s.indexOf('sendWhatsAppText'))
    assert.doesNotMatch(sms, /renderActions/)
    assert.match(s, /sendSMS\(lead\.phone, msg\)/, 'SMS sends the message alone')
  })

  test('a failure to build the menu does not cost the lead the message', () => {
    const at = s.indexOf('let menu')
    assert.notEqual(at, -1)
    // From the guard to the SEND, searching forward from the guard. Slicing to
    // the first `sendWhatsAppText` in the file found the import line, which is
    // above this block, so the slice came back empty and the test passed on
    // nothing.
    const sendAt = s.indexOf('sendWhatsAppText(lead.phone, msg + menu', at)
    assert.notEqual(sendAt, -1, 'the guarded block must be followed by the send')
    const block = s.slice(at, sendAt)
    assert.match(block, /catch/, 'the context build must be guarded')
    assert.doesNotMatch(block, /continue|return/,
      'a missing menu must not skip the message the lead was due')
  })
})

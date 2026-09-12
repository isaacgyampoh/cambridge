import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classify, classifyAll, scoreIntent, ESCALATING } from '../lib/chatbot/intent.ts'
import { nextStage, isHighIntent, STAGE_LABEL, type Stage } from '../lib/chatbot/stage.ts'
import { actionsFor, renderActions, matchAction } from '../lib/chatbot/actions.ts'
import { deriveStage } from '../lib/chatbot/eventState.ts'

/**
 * THE CONVERSATION ENGINE.
 *
 * The division this whole design rests on: the APPLICATION owns truth — fees,
 * dates, whether a brochure exists, when a person must be reached — and the
 * MODEL owns language. Everything below is the application's half, which is
 * exactly the half that must not need a model to be tested.
 */

const ALL: ProgCap = { canQuoteFee: true, canShowSchedule: true, canSendBrochure: true, canRegister: true }
type ProgCap = { canQuoteFee: boolean; canShowSchedule: boolean; canSendBrochure: boolean; canRegister: boolean }

describe('asking for a person always reaches one', () => {
  /*
   * Section 30 of the brief asks for at least fifteen semantic variants, and
   * section 16 for detection BEFORE the model call — so a person asking for a
   * person reaches one whether or not the model is available, in credit, or
   * right that day, and without it being given a chance to reassure them out
   * of it.
   */
  const VARIANTS = [
    'Can I speak to someone?',
    'I need a real person',
    'Can you connect me to Ruth?',
    'Let me talk to your staff',
    'I want to speak with the marketer',
    'Can someone help me directly?',
    'is this a bot?',
    'am i talking to a robot',
    'are you a real person',
    'call me',
    'give me a call please',
    'can somebody call me',
    'human please',
    'i want to talk to an advisor',
    'transfer me to an agent',
    'put me through to someone',
    'I need human assistance',
    'i dont want a bot',
    'speak to a consultant',
    'talk with a representative',
  ]

  test('every variant is classified as wanting a person', () => {
    const missed = VARIANTS.filter(v => classify(v) !== 'human')
    assert.deepEqual(missed, [],
      'these ask for a person and would have been answered by the model instead:\n  '
      + missed.join('\n  '))
  })

  test('and wanting a person is an escalating intent', () => {
    assert.ok(ESCALATING.has('human'))
    assert.ok(ESCALATING.has('payment'))
    assert.ok(ESCALATING.has('complaint'))
  })
})

describe('a question about their own money never gets an answer', () => {
  /*
   * The assistant cannot see anybody's record and must not appear to. Section
   * 14: it "must NOT pretend to see payment records".
   */
  const VARIANTS = [
    'I paid already',
    "I've paid but nothing has shown",
    'Has my payment gone through?',
    'I sent the money yesterday',
    'Can you confirm my payment?',
    "Why haven't I received confirmation?",
    'my payment has not reflected',
    'the transfer is not showing',
    'i want a refund',
    'what is my balance',
    'where is my receipt',
    'did you receive my money',
    'my momo did not go through',
    'i need my money back',
    'check my payment please',
  ]

  test('every variant escalates', () => {
    const missed = VARIANTS.filter(v => classify(v) !== 'payment')
    assert.deepEqual(missed, [],
      'these are about the person’s own money and would have been answered:\n  '
      + missed.join('\n  '))
  })

  test('their own money outranks curiosity about a fee', () => {
    // "I already paid, how much is left" is not a price question.
    assert.equal(classify('i already paid, how much is the balance'), 'payment')
  })
})

describe('brochure and registration are understood however they are phrased', () => {
  test('brochure', () => {
    for (const said of [
      'Send me the PDF',
      'Can I see the course document?',
      'Do you have a brochure?',
      'send the brochure',
      'share the prospectus',
      'can i get the syllabus',
      'show me the course outline',
    ]) {
      assert.equal(classify(said), 'brochure', `"${said}" was not read as a brochure request`)
    }
  })

  test('registration', () => {
    for (const said of [
      'I want to join',
      'How can I register?',
      'I want to sign up',
      'Put me down for the class',
      'how do i enrol',
      'count me in',
      'i want to apply',
      "i'm ready",
      'book me for the next cohort',
    ]) {
      assert.equal(classify(said), 'register', `"${said}" was not read as registration intent`)
    }
  })

  test('a message can carry more than one intent', () => {
    const both = classifyAll('send me the brochure and how much is it')
    assert.ok(both.includes('brochure'))
    assert.ok(both.includes('price'))
  })
})

describe('intent scoring orders the marketer’s queue', () => {
  // Section 21: internal only. It is never quoted back to the lead.
  test('wanting to register is the top score', () => {
    assert.equal(scoreIntent('I want to register'), 'READY_TO_REGISTER')
    assert.equal(scoreIntent('how do i pay'), 'READY_TO_REGISTER')
  })

  test('timing beats price, because timing is planning', () => {
    assert.equal(scoreIntent('when does the next class start'), 'HIGH')
    assert.equal(scoreIntent('how much is it'), 'MEDIUM')
  })

  test('idle curiosity scores low', () => {
    assert.equal(scoreIntent('hello'), 'LOW')
    assert.equal(scoreIntent('just checking'), 'LOW')
  })
})

describe('the conversation never moves backwards', () => {
  /*
   * Somebody who said they want to register and then asks one more question
   * about the timetable has not stopped wanting to register. Without this, a
   * queue ordered by stage would demote a hot lead for asking.
   */
  test('a later question does not demote a registration intent', () => {
    const after = nextStage('REGISTRATION_INTENT', { intent: 'schedule' })
    assert.equal(after, 'REGISTRATION_INTENT')
  })

  test('but it does advance when the signal is deeper', () => {
    assert.equal(nextStage('PRICE_DISCUSSION', { intent: 'register' }), 'REGISTRATION_INTENT')
    assert.equal(nextStage('DISCOVERY', { intent: 'brochure' }), 'BROCHURE_REQUEST')
  })

  test('a handover wins from anywhere and is not undone', () => {
    assert.equal(nextStage('DISCOVERY', { intent: 'question', handedOver: true }), 'HANDED_OVER')
    assert.equal(nextStage('HANDED_OVER', { intent: 'register' }), 'HANDED_OVER',
      'a message after a handover put the assistant back in charge')
  })

  test('registration intent onwards is what a marketer should see first', () => {
    assert.ok(isHighIntent('REGISTRATION_INTENT'))
    assert.ok(isHighIntent('HANDED_OVER'))
    assert.ok(!isHighIntent('DISCOVERY'))
  })

  test('every stage has a label a person can read', () => {
    for (const s of Object.keys(STAGE_LABEL) as Stage[]) {
      assert.ok(STAGE_LABEL[s] && !/^[A-Z_]+$/.test(STAGE_LABEL[s]),
        `${s} shows as a code rather than something readable`)
    }
  })
})

describe('an action is never offered unless it can be fulfilled', () => {
  /*
   * Section 6: "If a brochure does not exist, do not show 'See Brochure'."
   * The capability comes from the programme record, so an action that cannot
   * be honoured is never built.
   */
  test('no brochure on record means no brochure option', () => {
    const actions = actionsFor({
      capability: { ...ALL, canSendBrochure: false },
      stage: 'PROGRAMME_INTEREST',
    })
    assert.ok(!actions.some(a => a.id === 'brochure'),
      'a brochure was offered for a programme that has none')
  })

  test('no fee on record means no fees option', () => {
    const actions = actionsFor({ capability: { ...ALL, canQuoteFee: false }, stage: 'PROGRAMME_INTEREST' })
    assert.ok(!actions.some(a => a.id === 'view_fees'))
  })

  test('no registration link means no register option', () => {
    const actions = actionsFor({ capability: { ...ALL, canRegister: false }, stage: 'PROGRAMME_INTEREST' })
    assert.ok(!actions.some(a => a.id === 'register'))
  })

  test('reaching a person is always available', () => {
    const bare = actionsFor({
      capability: { canQuoteFee: false, canShowSchedule: false, canSendBrochure: false, canRegister: false },
      stage: 'DISCOVERY',
    })
    assert.deepEqual(bare.map(a => a.id), ['speak_to_human'],
      'with nothing else on offer, the option to reach a person must remain')
  })

  test('it is named after the colleague when there is one', () => {
    const a = actionsFor({ capability: ALL, stage: 'DISCOVERY', humanName: 'Ruth Mensah' })
      .find(x => x.id === 'speak_to_human')
    assert.equal(a?.label, 'Speak to Ruth')
  })

  test('nothing is offered once a person has the conversation', () => {
    assert.deepEqual(actionsFor({ capability: ALL, stage: 'HANDED_OVER' }), [])
    assert.deepEqual(actionsFor({ capability: ALL, stage: 'HUMAN_REQUESTED' }), [])
  })

  test('an action already taken is not offered again', () => {
    const actions = actionsFor({ capability: ALL, stage: 'PROGRAMME_INTEREST', taken: ['brochure'] })
    assert.ok(!actions.some(a => a.id === 'brochure'))
  })

  test('at most four, because this is a phone', () => {
    const actions = actionsFor({ capability: ALL, stage: 'PROGRAMME_INTEREST' })
    assert.ok(actions.length <= 4, `${actions.length} options is a wall of text on a handset`)
  })
})

describe('a reply to the numbered options is understood', () => {
  const offered = actionsFor({ capability: ALL, stage: 'PROGRAMME_INTEREST', humanName: 'Ruth' })

  test('a bare number', () => {
    assert.equal(matchAction('1', offered)?.id, offered[0].id)
    assert.equal(matchAction('2.', offered)?.id, offered[1].id)
    assert.equal(matchAction(' 3 ', offered)?.id, offered[2].id)
  })

  test('the words, too', () => {
    const brochure = offered.find(a => a.id === 'brochure')
    if (brochure) assert.equal(matchAction('brochure', offered)?.id, 'brochure')
  })

  test('a number nobody offered is not an action', () => {
    assert.equal(matchAction('9', offered), null)
  })

  test('an ordinary sentence is not mistaken for a choice', () => {
    assert.equal(matchAction('what does it cover?', offered), null,
      'a real question was swallowed as a menu selection')
  })

  test('the options are rendered as something a person can act on', () => {
    const text = renderActions(offered)
    assert.match(text, /Reply with a number/)
    assert.match(text, /\n1\. /)
    assert.equal(renderActions([]), '', 'an empty list must add nothing to the message')
  })
})

describe('state is derived from what actually happened', () => {
  /*
   * Section 4: "Do not depend entirely on the LLM to remember the state."
   * A model asked whether a brochure was already sent will usually be right,
   * and the times it is wrong are the times it matters.
   */
  const at = new Date().toISOString()
  const ev = (event: string) => ({ event: event as never, at, detail: '' })

  test('a handover outranks everything', () => {
    assert.equal(deriveStage({
      handedOver: true, registrationIntent: true, brochureSent: true,
      recent: [ev('HANDOVER_CREATED')],
    }), 'HANDED_OVER')
  })

  test('registration intent outranks a brochure', () => {
    assert.equal(deriveStage({
      handedOver: false, registrationIntent: true, brochureSent: true,
      recent: [ev('BROCHURE_SENT'), ev('REGISTRATION_INTENT')],
    }), 'REGISTRATION_INTENT')
  })

  test('a fresh conversation is NEW', () => {
    assert.equal(deriveStage({
      handedOver: false, registrationIntent: false, brochureSent: false, recent: [],
    }), 'NEW')
  })

  test('an opened conversation is past NEW', () => {
    assert.equal(deriveStage({
      handedOver: false, registrationIntent: false, brochureSent: false,
      recent: [ev('CHAT_STARTED')],
    }), 'DISCOVERY')
  })
})

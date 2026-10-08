import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { RecordingProvider } from '../lib/chatbot/../messaging/provider.ts'
import { classify, scoreIntent } from '../lib/chatbot/intent.ts'
import { nextStage, type Stage } from '../lib/chatbot/stage.ts'
import { actionsFor, matchAction, renderActions } from '../lib/chatbot/actions.ts'
import { deriveStage } from '../lib/chatbot/eventState.ts'
import { capabilityOf, describeProgramme, matchProgramme, type Programme } from '../lib/chatbot/programmeRules.ts'

/**
 * A LEAD'S WHOLE JOURNEY, AS THE APPLICATION DECIDES IT.
 *
 * Section 27 of the brief: test complete flows, not only individual
 * functions. These walk a conversation from first contact to handover through
 * the same rules a real WhatsApp message goes through — the intent
 * classifier, the stage machine, the capability-driven actions, the event-
 * derived state.
 *
 * What they deliberately do NOT do is call a model or a provider. Everything
 * asserted here is a decision the APPLICATION makes, which is the half that
 * must be right whether or not anything external is connected — and the half
 * that has been unverifiable end to end until the transport got an adapter.
 */

/** A programme with everything, as a well-configured centre would have. */
function fullProgramme(over: Partial<Programme> = {}): Programme {
  return {
    id: 'p1', name: 'Airbnb Management Masterclass', code: 'AIRBNB',
    description: 'Setting up and running a short-let business.',
    duration: '6 weeks',
    feeInPerson: 2500, feeOnline: 1800, registrationFee: 200,
    brochureUrl: 'https://files/airbnb.pdf',
    cohorts: [{
      name: 'October', startDate: '2026-10-12', startDateText: '12 October 2026',
      schedule: 'Saturdays, 9am to 1pm', venue: 'Accra', online: false, running: false,
    }],
    ...over,
  }
}

const LINK = 'https://portal.example/apply/RUTH01'

/** One turn: what the lead said, and what the application decides. */
function turn(stage: Stage, said: string, p: Programme | null, link: string | null) {
  const intent = classify(said)
  const cap = p ? capabilityOf(p, link) : {
    canQuoteFee: false, canShowSchedule: false, canSendBrochure: false, canRegister: false,
  }
  const next = nextStage(stage, { intent, hasProgramme: Boolean(p) })
  return {
    intent,
    stage: next,
    score: scoreIntent(said),
    actions: actionsFor({ capability: cap, stage: next, humanName: 'Ruth Mensah' }),
  }
}

describe('a lead who enquires, asks, and registers', () => {
  const programme = fullProgramme()

  test('the whole journey moves forward and never back', () => {
    let stage: Stage = 'NEW'
    const seen: Stage[] = []

    for (const said of [
      'Hi',
      "I'm interested in the Airbnb course",
      'How much is it?',
      'When does it start?',
      'Send me the brochure',
      'I want to register',
    ]) {
      const t = turn(stage, said, programme, LINK)
      stage = t.stage
      seen.push(stage)
    }

    assert.deepEqual(seen, [
      'DISCOVERY',
      'PROGRAMME_INTEREST',
      'PRICE_DISCUSSION',
      'PRICE_DISCUSSION',   // asking the date does not demote a price discussion
      'BROCHURE_REQUEST',
      'REGISTRATION_INTENT',
    ])
  })

  test('the score rises as the conversation does', () => {
    assert.equal(turn('NEW', 'Hi', programme, LINK).score, 'LOW')
    assert.equal(turn('DISCOVERY', 'How much is it?', programme, LINK).score, 'MEDIUM')
    assert.equal(turn('PRICE_DISCUSSION', 'When does it start?', programme, LINK).score, 'HIGH')
    assert.equal(turn('PRICE_DISCUSSION', 'I want to register', programme, LINK).score, 'READY_TO_REGISTER')
  })

  test('the options offered change with the conversation', () => {
    const early = turn('NEW', 'Hi', programme, LINK).actions.map(a => a.id)
    const ready = turn('PRICE_DISCUSSION', 'I want to register', programme, LINK).actions.map(a => a.id)

    assert.ok(early.includes('view_fees'), 'a new lead is not offered the fee')
    assert.ok(ready.includes('register'), 'a lead who wants to register is not offered registration')
    // Reaching a person survives every stage.
    for (const list of [early, ready]) assert.ok(list.includes('speak_to_human'))
  })

  test('a reply of "2" means what it was offered as', () => {
    const offered = turn('DISCOVERY', 'tell me more', programme, LINK).actions
    const chosen = matchAction('2', offered)
    assert.ok(chosen, 'a numbered reply resolved to nothing')
    assert.equal(chosen.id, offered[1].id)

    // And the words work too, so nobody has to learn the numbers.
    assert.equal(matchAction('brochure', offered)?.id, 'brochure')
  })
})

describe('a centre with nothing configured cannot mislead anybody', () => {
  const bare = fullProgramme({
    feeInPerson: null, feeOnline: null, registrationFee: null,
    brochureUrl: null, cohorts: [],
  })

  test('no fee, no date and no brochure are each stated as absent', () => {
    const text = describeProgramme(bare, capabilityOf(bare, null))
    assert.match(text, /Fee: NOT RECORDED/)
    assert.match(text, /Cohorts: NONE SCHEDULED/)
    assert.match(text, /Brochure: NOT available/)
    assert.ok(!/GHS/.test(text), 'a figure appeared for a programme with no fee')
  })

  test('and none of them is offered as an option', () => {
    const t = turn('DISCOVERY', 'tell me about it', bare, null)
    const ids = t.actions.map(a => a.id)
    for (const gone of ['view_fees', 'view_schedule', 'brochure', 'register'] as const) {
      assert.ok(!ids.includes(gone), `${gone} was offered for a programme that cannot support it`)
    }
    assert.deepEqual(ids, ['speak_to_human'],
      'with nothing to offer, the only honest option is a person')
  })
})

describe('asking for a person ends the assistant’s part', () => {
  const programme = fullProgramme()

  test('the request is recognised without a model', () => {
    for (const said of ['Can I speak to Ruth?', 'I want a real person', 'call me']) {
      assert.equal(classify(said), 'human', `"${said}" would have gone to the model`)
    }
  })

  test('and nothing is offered once it has', () => {
    const t = turn('PRICE_DISCUSSION', 'Can I speak to someone?', programme, LINK)
    assert.equal(t.stage, 'HUMAN_REQUESTED')
    assert.deepEqual(t.actions, [], 'options were offered to somebody who asked for a person')
  })

  test('a handover is not undone by whatever they say next', () => {
    let stage: Stage = 'HANDED_OVER'
    for (const said of ['hello?', 'I want to register', 'how much is it']) {
      stage = turn(stage, said, programme, LINK).stage
      assert.equal(stage, 'HANDED_OVER', `"${said}" put the assistant back in charge`)
    }
  })

  test('and nothing is offered while a person has it', () => {
    assert.deepEqual(turn('HANDED_OVER', 'hello', programme, LINK).actions, [])
  })
})

describe('the conversation remembers what already happened', () => {
  const at = new Date().toISOString()
  const ev = (event: string) => ({ event: event as never, at, detail: '' })

  test('a brochure already sent is not asked about again', () => {
    const state = {
      handedOver: false, registrationIntent: false, brochureSent: true,
      recent: [ev('BROCHURE_SENT'), ev('CHAT_STARTED')],
    }
    assert.equal(deriveStage(state), 'BROCHURE_REQUEST')

    // And the action is dropped, so the assistant does not re-offer it.
    const actions = actionsFor({
      capability: capabilityOf(fullProgramme(), LINK),
      stage: 'BROCHURE_REQUEST',
      taken: ['brochure'],
    }).map(a => a.id)
    assert.ok(!actions.includes('brochure'))
  })

  test('the furthest point reached is where the lead is', () => {
    // Not the most recent event: somebody who asked to register and then
    // asked one more question has not stopped wanting to register.
    assert.equal(deriveStage({
      handedOver: false, registrationIntent: true, brochureSent: true,
      recent: [ev('BROCHURE_SENT'), ev('REGISTRATION_INTENT'), ev('PROGRAMME_VIEWED')],
    }), 'REGISTRATION_INTENT')
  })
})

describe('the right programme, or a question', () => {
  const list = [
    fullProgramme({ id: '1', name: 'Airbnb Management Masterclass', code: 'AIRBNB' }),
    fullProgramme({ id: '2', name: 'Projects Management Professional', code: 'PMP' }),
    fullProgramme({ id: '3', name: 'Professional in Human Resources', code: 'PHRi' }),
    fullProgramme({ id: '4', name: 'Senior Professional in Human Resources', code: 'SPHR' }),
  ]

  test('a clear interest finds its programme', () => {
    assert.equal(matchProgramme(list, 'I want to do PMP')?.id, '2')
    assert.equal(matchProgramme(list, 'the airbnb one')?.id, '1')
  })

  test('an ambiguous one finds nothing, so the assistant asks', () => {
    // Recommending one of two HR programmes with confident detail is worse
    // than asking which they mean.
    assert.equal(matchProgramme(list, 'the human resources course'), null)
  })
})

describe('a channel that is not connected still runs the whole flow', () => {
  /*
   * The reason the adapter exists. With no WhatsApp line the sender used to
   * fail, so every step that follows a successful send was unreachable and
   * none of it could be exercised. A recording provider reports success, the
   * logic continues, and nothing reaches a person.
   */
  let outbox: RecordingProvider

  beforeEach(() => { outbox = new RecordingProvider('test') })

  test('it accepts a message and keeps it', async () => {
    const result = await outbox.send({ to: '233241234567', body: 'Hello', kind: 'text' })
    assert.equal(result.ok, true, 'a recorded send must report success or the flow stops')
    assert.equal(outbox.outbox.length, 1)
    assert.equal(outbox.outbox[0].body, 'Hello')
  })

  test('but never claims to have delivered it', () => {
    assert.equal(outbox.delivers, false,
      'a recording provider that claims delivery would let a screen imply somebody was contacted')
  })

  test('a conversation can be read back, which is the point', async () => {
    await outbox.send({ to: '233241234567', body: 'First', kind: 'text' })
    await outbox.send({ to: '233209999999', body: 'Someone else', kind: 'text' })
    await outbox.send({ to: '0241234567', body: 'Second', kind: 'text' })

    const theirs = outbox.to('0241234567').map(m => m.body)
    assert.deepEqual(theirs, ['First', 'Second'],
      'the same person in two number formats must read as one conversation')
  })

  test('the numbered options are rendered into what is actually sent', async () => {
    const actions = actionsFor({
      capability: capabilityOf(fullProgramme(), LINK), stage: 'DISCOVERY', humanName: 'Ruth',
    })
    await outbox.send({ to: '233241234567', body: 'Here you go.' + renderActions(actions), kind: 'text' })

    const sent = outbox.outbox[0].body
    assert.match(sent, /Reply with a number/)
    assert.match(sent, /1\. /)
    assert.match(sent, /Call Ruth/)
  })
})

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { needsHumanOutright, HANDOFF_LABEL, forWhatsApp, promisedFollowUp } from '../lib/chatbot/rules.ts'
import { courseLine, batchLine, ghs, longDate, hasFacts } from '../lib/chatbot/format.ts'

/**
 * THE CAMBRIDGE ASSISTANT.
 *
 * It replaces an agent that wrote in the assigned marketer's voice. That
 * agent's prompt said, in as many words:
 *
 *     You ARE {marketer}, a real person. Never say "as an AI", "assistant",
 *     "automated", or "bot", or anything hinting you are not human. Never
 *     offer to "connect them to a human", "pass them to someone", or "get a
 *     colleague" — from their side, you are the one person they are talking to.
 *
 * a humanise() pass stripped "the tells a model leaves behind", and the
 * webhook held every reply back for up to fourteen seconds because "an
 * instant response is the clearest sign a machine is on the other end".
 *
 * The centre reversed that decision. These tests are what stops it coming
 * back by accident.
 */

const persona = readFileSync('lib/chatbot/persona.ts', 'utf8')
const chatbot = readFileSync('lib/chatbot/index.ts', 'utf8')
const webhook = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')

/** Source with comments blanked — they quote the old prompt to explain it. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
            .replace(/^\s*\/\/.*$/gm, '')
}

describe('the assistant does not pretend to be a person', () => {
  test('the impersonating module is gone', () => {
    assert.ok(!existsSync('lib/integrations/ai-assistant.ts'),
      'the marketer-voiced assistant is back in the tree')
  })

  test('nothing writes in a named marketer’s voice', () => {
    // The old prompt was built from `marketerName` and `marketerIntro`, and
    // the reply was written in the first person as that person.
    assert.ok(!/marketerIntro|marketerName/.test(codeOf(persona)),
      'the persona is being built from a marketer identity again')
    assert.ok(!/marketerIntro/.test(codeOf(webhook)),
      'the webhook still passes a marketer voice to the assistant')
  })

  test('it says what it is when asked', () => {
    assert.match(persona, /you are an assistant, not a member of staff/i)
    assert.match(persona, /asks whether you are a human, a bot, or a real person/i,
      'the prompt does not tell it how to answer the one question that matters')
  })

  test('it never claims to have acted in the world', () => {
    // "I'll call you" from something that cannot call is the tell that costs
    // trust, because the call never comes.
    assert.match(persona, /Never say "I'll call you"/i)
  })

  test('the reply is no longer delayed to look human', () => {
    const code = codeOf(webhook)
    assert.ok(!/think \+ typing|14000/.test(code),
      'the fourteen-second disguise delay is back')
    assert.match(code, /900 \+ Math\.random\(\) \* 700/,
      'the short courtesy beat before replying is gone')
  })
})

describe('it hands over to a person', () => {
  test('asking for a human always reaches one, without a model', () => {
    /*
     * Deterministic on purpose. Somebody asking for a person must reach one
     * whether or not the model is available, in credit, or right that day.
     */
    for (const said of [
      'can i speak to a human',
      'I want to talk to someone',
      'please can I chat with an advisor',
      'is this a bot?',
      'are you a robot',
      'call me',
      'give me a call please',
    ]) {
      assert.equal(needsHumanOutright(said), 'asked_for_person', `"${said}" did not reach a person`)
    }
  })

  test('a question about their own money never gets an invented answer', () => {
    // The assistant cannot see their record and must not appear to.
    for (const said of [
      'i have paid but it is not showing',
      'my payment has not cleared',
      'what is my balance',
      'i want a refund',
      'where is my receipt',
    ]) {
      assert.equal(needsHumanOutright(said), 'own_record', `"${said}" was not treated as their own record`)
    }
  })

  test('a complaint goes to a person', () => {
    assert.equal(needsHumanOutright('this is a scam'), 'complaint')
    assert.equal(needsHumanOutright('I want to complain'), 'complaint')
  })

  test('an ordinary question is answered, not escalated', () => {
    for (const said of [
      'how much is PMP',
      'when does the next class start',
      'do you do weekend classes',
      'hello',
      'what programmes do you have',
    ]) {
      assert.equal(needsHumanOutright(said), null, `"${said}" was escalated unnecessarily`)
    }
  })

  test('every reason has something a colleague can read', () => {
    for (const reason of Object.keys(HANDOFF_LABEL)) {
      assert.ok(HANDOFF_LABEL[reason as keyof typeof HANDOFF_LABEL].length > 5,
        `${reason} has no readable label`)
    }
  })

  test('a handover marks the lead AND tells somebody', () => {
    const handoff = codeOf(readFileSync('lib/chatbot/handoff.ts', 'utf8'))
    assert.match(handoff, /needs_human: true, ai_paused: true/,
      'a handover that does not pause the assistant lets it talk over the colleague')
    assert.match(handoff, /from\('notifications'\)\.insert/,
      'the colleague is never told — the queue fills and the lead waits')
    assert.match(handoff, /HANDOVER NOT ANNOUNCED/,
      'a notification that fails leaves no trace')
  })

  test('the handover runs only after the reply was delivered', () => {
    /*
     * Marking first would pause the assistant before the person had been told
     * anyone was coming: they would simply stop hearing back.
     */
    const code = codeOf(webhook)
    const send = code.indexOf('const ok = await sendWhatsAppText(phone, reply')
    const hand = code.indexOf('handOffToHuman({')
    assert.ok(send > 0 && hand > send,
      'the handover is raised before the reply is sent')
    assert.match(code, /if \(ok && answer\.handoff/,
      'a handover is raised even when the reply failed to send')
  })

  test('a promise to check raises a handover', () => {
    // The same sentence that reassures the lead has to reach a person, or it
    // is a promise nobody was told about.
    assert.match(chatbot, /promisedFollowUp\(text\)/)
    assert.ok(promisedFollowUp("Let me check that and come back to you."))
    assert.ok(promisedFollowUp("I'll ask Ama to pick this up with you."))
    assert.ok(!promisedFollowUp('GHS 3,950. You can pay in bits.'),
      'an ordinary answer is being escalated as though it promised something')
  })
})

describe('it answers only from real records', () => {
  test('with no facts at all, it refuses to answer', () => {
    /*
     * A prompt is a request; this is a rule. A model with no facts and a
     * question about fees will produce a number.
     */
    assert.equal(hasFacts({ text: '', counts: { info: 0, faqs: 0, courses: 0, batches: 0 } }), false)
    assert.equal(hasFacts({ text: 'x', counts: { info: 0, faqs: 0, courses: 1, batches: 0 } }), true)
    assert.match(chatbot, /if \(!hasFacts\(knowledge\)\)/,
      'the assistant will answer questions of fact with nothing to answer from')
    assert.match(chatbot, /handoff: 'no_knowledge'/)
  })

  test('a fee is written the way the centre writes it', () => {
    assert.equal(ghs(3950), 'GHS 3,950')
    assert.equal(ghs('3950'), 'GHS 3,950')
    assert.equal(ghs(null), null)
    assert.equal(ghs('not a number'), null, 'a bad value would be quoted as a price')
  })

  test('a date is one a Ghanaian reader recognises', () => {
    assert.equal(longDate('2026-03-03'), '3 March 2026')
    assert.equal(longDate(null), null)
    assert.equal(longDate('rubbish'), null, 'an unparseable date would reach the lead')
  })

  test('a programme line carries only what the row holds', () => {
    assert.equal(courseLine({ name: 'PMP', price: 3950, duration: '8 weeks' }),
      '- PMP — GHS 3,950, 8 weeks')
    // No price on the record means no price in the message. It must not be
    // filled in, guessed, or left as "GHS null".
    assert.equal(courseLine({ name: 'PMP', price: null, duration: null }), '- PMP')
  })

  test('a class line never invents a date', () => {
    assert.equal(
      batchLine({ name: 'B1', class_type: 'online', status: 'upcoming', start_date: '2026-03-03', courses: { name: 'PMP' } }),
      '- PMP (online), starts 3 March 2026')
    assert.equal(
      batchLine({ name: 'B1', class_type: 'physical', status: 'upcoming', start_date: null, venue: null, courses: { name: 'PMP' } }),
      '- PMP',
      'a cohort with no start date must not acquire one')
  })

  test('the prompt forbids guessing, in the strongest terms available', () => {
    assert.match(persona, /NEVER GUESS/)
    assert.match(persona, /has my payment cleared/i,
      'the examples of what it may not guess have been thinned out')
  })
})

describe('replies read like WhatsApp', () => {
  test('em dashes and semicolons are removed', () => {
    // They read as written rather than typed, whoever wrote them.
    assert.equal(forWhatsApp('Yes — we do.'), 'Yes, we do.')
    assert.equal(forWhatsApp('It is 3950; you can pay in bits.'), 'It is 3950. you can pay in bits.')
  })

  test('a sign-off is stripped', () => {
    // Nobody signs a text message.
    assert.equal(forWhatsApp('Sure, that works.\n\nBest regards,\nCambridge'), 'Sure, that works.')
    assert.equal(forWhatsApp('See you then.\n- Cambridge Center of Excellence'), 'See you then.')
  })

  test('an ordinary reply is left alone', () => {
    assert.equal(forWhatsApp('GHS 3,950. You can pay in bits.'), 'GHS 3,950. You can pay in bits.')
  })

  test('the function no longer exists to hide what it is', () => {
    // It grew out of humanise(), whose stated job was removing "the tells a
    // model leaves behind". Only the formatting half survives.
    const rules = codeOf(readFileSync('lib/chatbot/rules.ts', 'utf8'))
    assert.ok(!/\bhumanise\b/.test(rules), 'the deception pass is back under its old name')
  })
})

describe('a handover is not undone by the next message', () => {
  test('the webhook only clears a pause nobody meant', () => {
    /*
     * This read `!humanTurns || ai_paused_by !== 'manual'`, which resumed
     * anything that was not a manual takeover — including the assistant's own
     * handovers, on the very next message.
     */
    const code = codeOf(webhook)
    assert.match(code, /if \(!humanTurns && !pausedBy\)/,
      'the auto-resume clears handovers again')
  })

  test('the quiet-hours net covers the causes that are actually written', () => {
    /*
     * It tested for 'human'. Nothing ever wrote 'human' — the webhook writes
     * 'manual' — so the net never fired once and a lead whose marketer went
     * quiet stayed unanswered until somebody noticed.
     */
    const resume = readFileSync('lib/aiResume.ts', 'utf8')
    assert.match(resume, /cause !== 'manual' && cause !== 'assistant'/,
      'the resume path checks for a value nothing writes')
    assert.match(resume, /lead\.updated_at/,
      'an assistant handover has no last_human_at and would resume immediately')
  })

  test('it measures from a column that exists', () => {
    // Naming one that does not fails the whole select. That is how
    // lead_assign_pending.last_sms_at silenced every assignment notification.
    const resume = codeOf(readFileSync('lib/aiResume.ts', 'utf8'))
    assert.ok(!/ai_paused_at/.test(resume),
      'ai_paused_at is not a column on leads — the select would fail as a unit')
  })
})

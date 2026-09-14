import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { askedDeliveryMode, modeWord } from '../lib/chatbot/deliveryMode.ts'

/**
 * TWO THOUSAND CEDIS OF AMBIGUITY.
 *
 * The centre sells one programme two ways at two prices — PMP is GHS 4,950 in
 * person and GHS 3,950 online — and staff and leads both call them "PMP
 * Physical" and "PMP Virtual".
 *
 * The assistant was handed both figures and nothing told it which one had been
 * asked for. "How much is virtual PMP?" and "how much is PMP?" arrived
 * identically, and a model given two prices and no steer answers with both,
 * or the first, or folds the difference into a sentence that is neither.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the centre’s own vocabulary is understood', () => {
  test('"virtual" means online — it is what people here actually say', () => {
    for (const s of [
      'How much is virtual PMP?',
      'Do you have virtual classes?',
      'I want the virtual one',
      'is PMP available virtually',
    ]) {
      assert.equal(askedDeliveryMode(s), 'online', `not understood: ${s}`)
    }
  })

  test('"physical" means in person', () => {
    for (const s of [
      'How much is physical PMP?',
      'I prefer physical classes',
      'can I attend physically',
    ]) {
      assert.equal(askedDeliveryMode(s), 'in_person', `not understood: ${s}`)
    }
  })

  test('the ordinary words work too', () => {
    for (const [s, expected] of [
      ['is it online?', 'online'],
      ['can I join remotely', 'online'],
      ['do you use zoom', 'online'],
      ['I want to study from home', 'online'],
      ['is it in person', 'in_person'],
      ['in-person classes please', 'in_person'],
      ['do I come to the centre', 'in_person'],
      ['face to face', 'in_person'],
    ] as const) {
      assert.equal(askedDeliveryMode(s), expected, `not understood: ${s}`)
    }
  })
})

describe('it does not guess', () => {
  test('a message that says nothing about mode returns null', () => {
    /*
     * The common case, and the right default. Most enquiries do not mention a
     * mode, and guessing one is worse than the ambiguity it replaces — the
     * prompt then leaves both fees standing, which is the honest answer.
     */
    for (const s of [
      'How much is PMP?',
      'I want to register',
      'when does it start',
      '',
    ]) {
      assert.equal(askedDeliveryMode(s), null, `should not have guessed: ${s}`)
    }
  })

  test('naming BOTH is a question about the difference, not a choice', () => {
    for (const s of [
      'is it physical or virtual?',
      'do you do online and in person?',
      'what is the difference between virtual and physical',
    ]) {
      assert.equal(askedDeliveryMode(s), null, `should have stayed neutral: ${s}`)
    }
  })

  test('a word that merely contains one of these is not a match', () => {
    // Word boundaries throughout. "onsite" must not be read through "site",
    // and "online" must not match inside a longer word.
    assert.equal(askedDeliveryMode('my offline notes'), null)
    assert.equal(askedDeliveryMode('the website'), null)
  })

  test('the label is what the centre would write to a lead', () => {
    assert.equal(modeWord('online'), 'online')
    assert.equal(modeWord('in_person'), 'in person')
  })
})

describe('the prompt states the fee that answers the question', () => {
  const persona = codeOf('lib/chatbot/persona.ts')

  test('the applicable fee is named, from the programme record', () => {
    assert.match(persona, /askedMode === 'online' \? ctx\.programme\.feeOnline : ctx\.programme\.feeInPerson/)
    assert.match(persona, /THEY ASKED ABOUT ATTENDING/)
    assert.match(persona, /Quote THAT figure/)
  })

  test('and the model is told not to blend the two', () => {
    assert.match(persona, /do not average or combine them/)
  })

  test('nothing is added when no mode was named', () => {
    // Both fees then stand, which is the honest answer to a question that did
    // not specify.
    assert.match(persona, /if \(!askedMode \|\| !ctx\.programme\) return ''/)
  })

  test('nor when no fee is recorded for that mode', () => {
    // Announcing a mode with no price behind it would invite the model to
    // supply one.
    assert.match(persona, /typeof fee !== 'number' \|\| fee <= 0/)
  })

  test('the engine passes what the lead actually meant', () => {
    const engine = codeOf('lib/chatbot/index.ts')
    assert.match(engine, /askedMode: askedDeliveryMode\(effective\)/,
      '`effective` resolves a numbered reply to its meaning first.')
  })
})

describe('a returning lead is never duplicated by a failed read', () => {
  const src = codeOf('app/api/webhooks/whatsapp/route.ts')

  test('the lead lookup checks whether it worked', () => {
    /*
     * The error was discarded, so a blip produced `lead = null` — exactly what
     * an unknown number produces — and execution carried on into the branch
     * that CREATES one. The person already exists: history, call notes,
     * status, and a marketer working them. A second row splits all of it.
     */
    assert.match(src, /const \{ row: foundLead, failed: leadFailed \} = await lookup\(/)
  })

  test('and stops rather than creating a second person', () => {
    const guard = src.indexOf('if (leadFailed)')
    const create = src.indexOf('await intakeLead(')
    assert.ok(guard > 0 && guard < create, 'The guard must precede lead creation.')
    assert.match(src.slice(guard, create), /return NextResponse\.json/,
      'It must return, not fall through.')
  })

  test('the message is recorded so a person can pick it up', () => {
    // Staying silent for one message is recoverable. A duplicated lead is not.
    assert.match(src, /lead_lookup_failed/)
    assert.match(src, /reply manually if it needs an answer/)
  })

  test('intakeLead’s sixty-day window is why this matters', () => {
    // It would not catch a lead from last term, so the webhook's own
    // unbounded lookup is the only thing standing between a returning enquiry
    // and a duplicate.
    const intake = codeOf('lib/leadIntake.ts')
    assert.match(intake, /60 \* 24 \* 3600 \* 1000/)
  })
})

describe('the assistant can be tried without WhatsApp', () => {
  const api = codeOf('app/api/admin/chatbot-simulate/route.ts')

  test('it runs the real engine, not a copy of it', () => {
    /*
     * A diagnostic that reimplements what it diagnoses can only report on
     * itself. The SMS test endpoint in this codebase did exactly that for
     * months, reporting success through a sender it never exercised.
     */
    assert.match(api, /chatbotReply\(/)
    assert.match(api, /buildLeadContext\(/)
    assert.ok(!/aiComplete\(/.test(api), 'It must not call the model directly.')
    assert.ok(!/buildSystemPrompt/.test(api), 'It must not assemble its own prompt.')
  })

  test('it changes nothing', () => {
    for (const write of ['recordEvent', 'handOffToHuman', 'sendWhatsApp', 'intakeLead', '.insert(']) {
      assert.ok(!api.includes(write), `${write} would make a simulation alter real state.`)
    }
  })

  test('"it works" is never mistaken for "it is live"', () => {
    assert.match(api, /mode: 'simulation'/)
    assert.match(api, /sent: false/)
    assert.match(api, /whatsappConnected: whatsappConnected\(\)/)
    const page = codeOf('app/(portal)/admin/chatbot/page.tsx')
    assert.match(page, /Nothing is sent/)
  })

  test('it uses the same fail-closed lead lookup as the webhook', () => {
    // A simulation that quietly invented a lead would test the wrong thing.
    assert.match(api, /const \{ row: lead, failed \} = await lookup\(/)
    assert.match(api, /if \(failed\)[\s\S]{0,220}503/)
  })

  test('it does not name the marketer', () => {
    // Whether a lead HAS an owner is the diagnostic fact; who they are is not.
    assert.match(api, /assigned: Boolean\(/)
    assert.ok(!/marketerName|assigned_to:\s*\(/.test(api))
  })

  test('it is staff-only', () => {
    assert.match(api, /roles: \['super_admin', 'administrator', 'project_manager'\]/)
  })
})

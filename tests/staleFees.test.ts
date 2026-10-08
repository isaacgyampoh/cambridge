import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { unbackedAmounts, allowedAmounts, amountsIn } from '../lib/chatbot/moneyGuard.ts'

function code(path: string) {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * Isaac reported the system still sends old fees. The code computes fees from
 * the course record, so a superseded figure reaching a student means it is
 * STORED somewhere. These cover the two places the code can be wrong about.
 */

describe('a superseded fee written in the knowledge base is reportable', () => {
  const programmes = [{ feeInPerson: 5950, feeOnline: 4950, registrationFee: 200 }]

  test('the money guard does permit a stale knowledge figure — that is the hole', () => {
    // Not a bug in the guard: its question is "did we write this down", not
    // "is it still true". This pins the behaviour the report exists for.
    const stale = 'Our PMP programme costs GHS 3,950.'
    const allowed = allowedAmounts(programmes, stale)
    assert.ok(allowed.has('3950'),
      'the guard blesses any amount in the knowledge text, including a superseded one')
  })

  test('and that figure is reported as unbacked', () => {
    const found = unbackedAmounts(programmes, 'Our PMP programme costs GHS 3,950.')
    assert.deepEqual(found, ['3950'])
  })

  test('current fees are not reported', () => {
    const text = 'PMP is GHS 5,950 in person, GHS 4,950 online, plus GHS 200 registration.'
    assert.deepEqual(unbackedAmounts(programmes, text), [])
  })

  test('each unbacked amount is reported once, in the order found', () => {
    const text = 'Was GHS 3,950. Still GHS 3,950 for some. Also GHS 1,200 deposit.'
    assert.deepEqual(unbackedAmounts(programmes, text), ['3950', '1200'])
  })

  test('the written forms of one amount are one amount', () => {
    for (const form of ['GHS 3,950', 'GH₵3950', 'GHc 3,950.00', '₵3950', '3,950 cedis']) {
      assert.deepEqual(unbackedAmounts(programmes, form), ['3950'], `failed on ${form}`)
    }
  })

  test('no programmes means nothing is backed, so nothing is silently cleared', () => {
    // A failed programme load must not make every stale figure look fine.
    assert.deepEqual(unbackedAmounts([], 'GHS 5,950'), ['5950'])
  })

  test('empty text reports nothing', () => {
    assert.deepEqual(unbackedAmounts(programmes, ''), [])
    assert.deepEqual(unbackedAmounts(programmes), [])
  })

  test('it never reports an amount that is not there', () => {
    assert.deepEqual(amountsIn('no money here'), [])
    assert.deepEqual(unbackedAmounts(programmes, 'no money here'), [])
  })

  test('the admin check surfaces it rather than failing the chatbot', () => {
    const s = code('app/api/admin/chatbot-check/route.ts')
    assert.match(s, /unbackedAmounts\(/, 'the check must run')
    assert.match(s, /id: 'fee_text'/, 'and report under its own id')
    // A registration fee or instalment legitimately has no course row, so
    // this must not be a hard failure.
    const block = s.slice(s.indexOf("id: 'fee_text'") - 400, s.indexOf("id: 'fee_text'") + 900)
    assert.doesNotMatch(block, /status: 'fail'/, 'an unbacked amount is to be checked, not a failure')
    assert.match(block, /status: 'warn'/)
  })
})

describe('the class reminder stops chasing money when fee reminders are off', () => {
  const s = code('lib/student/classReminder.ts')

  test('it reads the same switch as every other fee reminder', () => {
    // This runs every ten minutes and tells a student what to pay. It is a
    // payment reminder, and nothing here consulted the switch — which is how
    // fee messages kept arriving after reminders were turned off.
    assert.match(s, /REMINDERS_KEY/, 'it must read the fee-reminder switch')
    assert.match(s, /remindersEnabled/, 'and apply the shared policy')
  })

  test('the money sentence is gated on it', () => {
    assert.match(s, /owed > 0 && chaseFees/,
      'the amount-owed message must require the switch to be on')
  })

  test('the class reminder itself still goes out', () => {
    // A student with a class in thirty minutes needs the link whatever has
    // been decided about chasing fees.
    assert.match(s, /sendWhatsAppText\(/, 'the reminder must still send')
    const gate = s.indexOf('chaseFees = remindersEnabled')
    const earlyReturn = s.slice(0, s.indexOf('sendWhatsAppText('))
    assert.ok(gate !== -1)
    assert.doesNotMatch(earlyReturn.slice(gate), /return \{ sent: 0/,
      'the switch must not abort the whole run')
  })

  test('a failed read does not chase fees', () => {
    /*
     * Look inside the CATCH BLOCK. An earlier version of this test matched
     * `chaseFees = false` anywhere in the file, which the initial declaration
     * satisfies on its own — it passed with the catch block inverted to
     * `chaseFees = true`, the exact failure it was meant to stop.
     */
    const catchAt = s.indexOf('catch (e: unknown)')
    assert.notEqual(catchAt, -1, 'the read must be wrapped')
    const body = s.slice(catchAt, s.indexOf('}', s.indexOf('chaseFees', catchAt)) + 1)
    assert.match(body, /chaseFees = false/,
      'an unreadable switch must fall to NOT chasing, inside the catch')
    assert.doesNotMatch(body, /chaseFees = true/)
  })

  test('the switch is read once per run, not once per student', () => {
    const reads = (s.match(/eq\('key', REMINDERS_KEY\)/g) || []).length
    assert.equal(reads, 1, 'one read per run')
    const readAt = s.indexOf('REMINDERS_KEY')
    const loopAt = s.search(/for \(const (b|st) of/)
    assert.ok(readAt !== -1 && loopAt !== -1 && readAt < loopAt,
      'the read must sit above the loops')
  })
})

describe('the source does not assert fees it cannot keep true', () => {
  test('no hardcoded PMP price is stated as fact in these two files', () => {
    // These two named DIFFERENT prices for the same programme: 4,950/3,950 in
    // one, 5,950/4,950 in the other. Both were comments, neither was read by
    // any code, and one of them had to be wrong.
    for (const f of ['lib/chatbot/deliveryMode.ts', 'lib/admissions/letterPolicy.ts']) {
      const raw = readFileSync(f, 'utf8')
      assert.doesNotMatch(raw, /PMP is GHS/, `${f} still asserts a PMP price`)
    }
  })

  test('the automation page no longer promises what it does not send', () => {
    const raw = readFileSync('app/(portal)/admin/automation/page.tsx', 'utf8')
    assert.doesNotMatch(raw, /desc: '30 minutes before class, with what they owe'/,
      'that claim is only true while fee reminders are on')
    assert.match(raw, /only while Fee reminders are on/)
  })
})

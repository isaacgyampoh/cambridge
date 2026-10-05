import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REMINDERS_KEY, remindersEnabled, DISABLED_REASON } from '../lib/payments/reminderPolicy.ts'

/**
 * Isaac asked for payment reminders to be turned off.
 *
 * They were going out daily and unattended to every student with a balance.
 * Three separate code paths can send one, and these tests pin down that all
 * three ask the same switch, and that the switch fails closed.
 */

/** Comments explain the guard; they are not the guard. Strip them first. */
function code(path: string) {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the switch itself', () => {
  test("only the literal string 'true' sends", () => {
    assert.equal(remindersEnabled('true'), true)
    assert.equal(remindersEnabled('false'), false)
  })

  test('an absent setting means OFF, not on', () => {
    // This is the polarity that matters. auto_assign_leads defaults ON when
    // its row is missing; this must not, or a lost row starts messaging
    // hundreds of people about money.
    assert.equal(remindersEnabled(null), false)
    assert.equal(remindersEnabled(undefined), false)
  })

  test('nothing truthy-but-wrong slips through', () => {
    for (const v of ['TRUE', 'True', '1', 'yes', 'on', 'enabled', ' true', 'true ', '']) {
      assert.equal(remindersEnabled(v), false, `${JSON.stringify(v)} must not enable reminders`)
    }
  })
})

describe('every path that can message a student consults it', () => {
  // The shared broadcast, used by the daily cron and the finance Send button.
  test('broadcastPaymentReminders reads the switch and returns before sending', () => {
    const whole = code('lib/paymentReminderBroadcast.ts')
    assert.match(whole, /REMINDERS_KEY/, 'the broadcast must read the switch')

    /*
     * Search the FUNCTION BODY, not the file. An earlier version of this test
     * looked for `remindersEnabled` anywhere and compared its position to the
     * first send — which the import line at the top satisfied on its own. It
     * passed with the guard deleted. The body is where the guard has to be.
     */
    const bodyAt = whole.indexOf('export async function broadcastPaymentReminders')
    assert.notEqual(bodyAt, -1)
    const body = whole.slice(bodyAt)

    // Not just a mention: a negated check that RETURNS.
    const guard = /if \s*\(\s*!\s*remindersEnabled\s*\([\s\S]{0,80}?\)\s*\)\s*\{?[\s\S]{0,200}?return/
      .exec(body)
    assert.ok(guard, 'the body must refuse to continue when the switch is off')

    const firstSend = Math.min(
      ...['sendWhatsAppText(', 'sendSMS('].map(n => {
        const i = body.indexOf(n)
        return i === -1 ? Number.MAX_SAFE_INTEGER : i
      }),
    )
    assert.notEqual(firstSend, Number.MAX_SAFE_INTEGER, 'this is the sender; it must send')
    assert.ok(guard.index < firstSend, 'the switch must be checked before anything is sent')
  })

  // A second, independent sender: it reads `invoices`, not `student_fees`,
  // so the guard in the broadcast does not cover it.
  test('the finance invoices route has its own check', () => {
    const whole = code('app/api/finance/payment-reminder/route.ts')
    const bodyAt = whole.indexOf('export async function POST')
    assert.notEqual(bodyAt, -1)
    const body = whole.slice(bodyAt)

    const guard = /if \s*\(\s*!\s*remindersEnabled\s*\([\s\S]{0,80}?\)\s*\)\s*\{?[\s\S]{0,200}?return/
      .exec(body)
    assert.ok(guard, 'the invoices route must refuse to continue when the switch is off')

    const send = body.indexOf('sendSMS(')
    assert.notEqual(send, -1)
    assert.ok(guard.index < send,
      'the switch must be checked before the invoices route sends')
  })

  test('a skip is not reported to finance as a successful send', () => {
    const s = code('app/api/payment-reminders/send/route.ts')
    assert.match(s, /skipped/,
      'the send route must notice a skip rather than spreading it into success')
    assert.match(s, /status:\s*409/,
      'a refused send must not answer 200')
  })
})

describe('the state is explicit, not just implied by a missing row', () => {
  test('a migration writes the switch off', () => {
    const sql = readFileSync('supabase/migrations/0024_payment_reminders_off.sql', 'utf8')
    assert.match(sql, new RegExp(REMINDERS_KEY))
    assert.match(sql, /'false'/)
  })

  test('the pending-migration bundle carries it', () => {
    const sql = readFileSync('supabase/migrations/APPLY-ALL-PENDING.sql', 'utf8')
    assert.match(sql, new RegExp(REMINDERS_KEY),
      'APPLY-ALL-PENDING must include 0024 or the row is never written')
  })

  test('the daily cron task is still listed, so it can be switched back on', () => {
    // Deleting the task would have turned the toggle into a lie: flipping it
    // on would never resume the daily send.
    const s = code('app/api/cron/run/route.ts')
    assert.match(s, /payment_reminders/,
      'the task stays in the fan-out; the switch is what stops it')
  })
})

describe('the people using it are told', () => {
  test('finance sees that reminders are off instead of a dead button', () => {
    const s = readFileSync('app/(portal)/finance/reminders/page.tsx', 'utf8')

    /*
     * The button itself must be disabled. Checking only that the file
     * mentions `enabled === false` passed even after the Send button was
     * re-enabled, because the phrase survived in the button's label.
     */
    const disabled = /disabled=\{[^}]*enabled === false[^}]*\}/.exec(s)
    assert.ok(disabled, 'the Send button must be disabled while reminders are off')

    // And the explanation must be reachable, not behind a dead branch.
    assert.match(s, /\{preview && preview\.enabled === false \? \(/,
      'the explanation must be shown on the real condition')
    assert.match(s, /switched off/i, 'and say so in words')
  })

  test('the preview endpoint reports the state so the page can', () => {
    const s = code('app/api/payment-reminders/preview/route.ts')
    assert.match(s, /enabled/, 'preview must report whether reminders are on')
  })

  test('a super admin can turn them back on without a deploy', () => {
    const s = readFileSync('app/(portal)/admin/settings/page.tsx', 'utf8')
    assert.match(s, new RegExp(REMINDERS_KEY), 'the Settings toggle must write the switch')
    assert.match(s, /role="switch"[\s\S]*?aria-checked=\{feeReminders\}/,
      'and it must be a real switch control')
  })

  test('the reason given is a sentence, not a code', () => {
    assert.match(DISABLED_REASON, /switched off/i)
    assert.match(DISABLED_REASON, /Nothing was sent/i)
  })
})

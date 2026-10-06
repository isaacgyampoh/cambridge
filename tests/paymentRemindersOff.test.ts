import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REMINDERS_KEY, remindersEnabled, DISABLED_REASON, isOverdue, formatDueDate, NO_DUE_DATE } from '../lib/payments/reminderPolicy.ts'

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
    // POST and GET both delegate to one handler now, so that is where the
    // guard has to live.
    const bodyAt = whole.indexOf('async function sendReminders')
    assert.notEqual(bodyAt, -1, 'expected a single shared handler')
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

describe('the invoice route could never run, and two bugs hid inside it', () => {
  /*
   * It demanded a finance session AND a cron secret. No caller holds both:
   * a browser does not send CRON_SECRET, and the GET entry rebuilt the
   * request with the bearer but no cookies, so the session check then failed.
   * Both verbs answered 401 for everyone, since 47a8409.
   */
  test('the scheduler OR a permitted person, never both at once', () => {
    const s = code('app/api/finance/payment-reminder/route.ts')

    assert.match(s, /if \s*\(\s*isValidCronRequest\(req\)\s*\)\s*return/,
      'a valid cron request must be sufficient on its own')

    // The dead shape: a negated cron check that rejects, sitting alongside a
    // session check that also rejects. Either one alone must not 401 a caller
    // the other would have allowed.
    assert.doesNotMatch(s, /if \s*\(\s*!\s*isValidCronRequest\(req\)\s*\)\s*\{?\s*\n?\s*return NextResponse\.json\(\{\s*error/,
      'a missing cron secret must not reject a signed-in accountant')

    // And GET must not rebuild the request, which dropped the cookies.
    assert.doesNotMatch(s, /new NextRequest\(/,
      'GET must not re-invoke POST with a synthesised request; cookies are lost')
  })

  test('only finance roles, matching the canonical sender', () => {
    const s = code('app/api/finance/payment-reminder/route.ts')
    const list = /const ALLOWED = \[([^\]]*)\]/.exec(s)
    assert.ok(list, 'the route must state who may chase students for money')
    const roles = list[1].split(',').map(r => r.trim().replace(/['"]/g, '')).filter(Boolean)
    assert.deepEqual(roles.sort(), ['accountant', 'super_admin'],
      'this must match /api/payment-reminders/send; two lists for one capability drift apart')
  })

  test('one channel failing does not discard the other', () => {
    const s = code('app/api/finance/payment-reminder/route.ts')
    // Promise.all threw away a successful WhatsApp send when the SMS threw,
    // so a student who HAD been messaged was neither counted nor logged, and
    // the next run messaged them again.
    assert.match(s, /Promise\.allSettled\(/, 'each channel must be judged on its own')
    assert.doesNotMatch(s, /Promise\.all\(\s*\[\s*\n?\s*sendSMS/,
      'Promise.all loses one channel when the other rejects')
  })
})

describe('overdue was unreachable', () => {
  const now = Date.parse('2026-10-06T12:00:00Z')

  test('a past due date is overdue', () => {
    assert.equal(isOverdue('2026-09-30', now), true)
  })

  test('a future due date is not', () => {
    assert.equal(isOverdue('2026-12-01', now), false)
  })

  test('the original comparison answered on the day of the month, not the date', () => {
    /*
     * The shipped line compared the FORMATTED date against an ISO timestamp
     * as strings, so the verdict came from the first digit of the day. It was
     * wrong in BOTH directions, which is what this pins. (My first version of
     * this test claimed it was simply always 'balance'. It is not — "1
     * December" sorts below "2026…" — so the test failed and said so.)
     */
    const asShipped = (due: string) =>
      formatDueDate(due) < new Date(now).toISOString() ? 'overdue' : 'balance'

    // Past, but the day is 30: called current. A real debt goes unflagged.
    assert.equal(asShipped('2026-09-30'), 'balance')
    assert.equal(isOverdue('2026-09-30', now), true, 'it is in fact overdue')

    // Months away, but the day is 1: called overdue.
    assert.equal(asShipped('2026-12-01'), 'overdue')
    assert.equal(isOverdue('2026-12-01', now), false, 'it is in fact not due yet')

    // And the no-date sentence sorted as current, which was right by accident.
    assert.equal(asShipped(''), 'balance')
  })

  test('an unknown due date is not treated as overdue', () => {
    // Guessing harshly is how a paid-up student gets chased.
    assert.equal(isOverdue(null, now), false)
    assert.equal(isOverdue(undefined, now), false)
    assert.equal(isOverdue('not a date', now), false)
    assert.equal(isOverdue('', now), false)
  })

  test('a missing due date reads as a sentence, not "Invalid Date"', () => {
    assert.equal(formatDueDate(null), NO_DUE_DATE)
    assert.equal(formatDueDate('not a date'), NO_DUE_DATE)
    assert.doesNotMatch(formatDueDate(undefined), /invalid/i)
  })
})

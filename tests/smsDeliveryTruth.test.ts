import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readDeliveryReport, undeliveredExplanation } from '../lib/integrations/smsDeliveryReport.ts'

/**
 * "DELIVERED" MEANT "THE PROVIDER TOOK IT".
 *
 * ── HOW THIS WAS FOUND ─────────────────────────────────────────────────────
 *
 * Reported: staff are not receiving the SMS for a PIN reset. The delivery
 * screen showed those messages as Delivered, with a green badge, so the
 * search went looking for a fault in the sending code.
 *
 * Asking Arkesel about three messages it had accepted within two minutes of
 * each other settled it:
 *
 *   233244447134   DELIVERED
 *   233558659948   DELIVERED
 *   233244721555   NOT_DELIVERED     ← the number the report was about
 *
 * The sending code was working. One number was receiving nothing, and the
 * portal had no vocabulary for saying so: `status = 'sent'` was labelled
 * "Delivered", and there was no state meaning "the network refused it".
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ' '))
}

/** Arkesel's real shape, from the account this product sends on. */
const reply = (status: string) => ({
  data: {
    ID: 'd33b6495-4a46-453d-a1b2-db1337df732c',
    status,
    sender: 'CambridgeCE',
    recipient: '233244721555',
    message: 'CCE: …',
    message_count: 1,
  },
})

describe('what the network says is written down as said', () => {
  test('a delivered message is delivered', () => {
    assert.deepEqual(readDeliveryReport(200, reply('DELIVERED')),
      { state: 'delivered', detail: 'DELIVERED' })
  })

  test('and the one the report was about is not', () => {
    const report = readDeliveryReport(200, reply('NOT_DELIVERED'))
    assert.equal(report.state, 'undelivered')
    assert.equal(report.detail, 'NOT_DELIVERED')
  })

  test('every way a network gives up counts as undelivered', () => {
    for (const s of ['EXPIRED', 'REJECTED', 'BLOCKED', 'FAILED', 'DND', 'UNDELIVERED']) {
      assert.equal(readDeliveryReport(200, reply(s)).state, 'undelivered', `${s} was not read as a failure`)
    }
  })

  test('one still in flight is left alone rather than judged', () => {
    for (const s of ['PENDING', 'SUBMITTED', 'ACCEPTED', 'QUEUED']) {
      assert.equal(readDeliveryReport(200, reply(s)).state, 'pending', `${s} was settled too early`)
    }
  })

  test('and a lookup that did not answer says nothing about the message', () => {
    /*
     * The important half. A timeout, a 500 or an unrecognised word must not
     * become "undelivered" — that would invent exactly the failure this is
     * here to detect, and send somebody to re-check a phone number that is
     * perfectly correct.
     */
    assert.equal(readDeliveryReport(500, {}).state, 'unknown')
    assert.equal(readDeliveryReport(200, {}).state, 'unknown')
    assert.equal(readDeliveryReport(200, reply('SOMETHING_NEW')).state, 'unknown')
    assert.equal(readDeliveryReport(404, {}).state, 'unknown')
  })

  test('a reference the provider has never heard of is not a failed delivery', () => {
    // Most often a reference from another account, or one old enough to have
    // been purged. Marking it undelivered sends somebody chasing a handset
    // over a bookkeeping difference.
    assert.match(readDeliveryReport(404, {}).detail, /no record/i)
  })

  test('the explanation points at the far end, where the problem is', () => {
    const text = undeliveredExplanation('NOT_DELIVERED')
    assert.match(text, /switched off or out of coverage/)
    assert.match(text, /blocking messages from this sender/)
    assert.match(text, /Resending will not change it/)
  })
})

describe('the reconciler only writes what it was told', () => {
  const src = codeOf('lib/notifications/smsReconcile.ts')

  test('it asks about messages the provider accepted and has not resolved', () => {
    assert.match(src, /\.eq\('status', 'sent'\)/)
    assert.match(src, /\.not\('provider_message_id', 'is', null\)/)
    assert.match(src, /deliveryReportFor\(String\(row\.provider_message_id\)\)/)
  })

  test('and records each answer under its own state', () => {
    assert.match(src, /state === 'delivered'/)
    assert.match(src, /status: 'delivered'/)
    assert.match(src, /state === 'undelivered'/)
    assert.match(src, /status: 'undelivered', last_error: undeliveredExplanation/)
  })

  test('an inconclusive answer leaves the row exactly as it was', () => {
    /*
     * The row must not be touched: the next pass asks again. Writing anything
     * here — even 'sent' again — would close a question that is still open.
     */
    const tail = src.slice(src.indexOf("state === 'undelivered'"))
    assert.ok(!/update\(/.test(tail.slice(tail.indexOf('out.undelivered++'))),
      'something is written for an answer that did not come')
    assert.match(src, /out\.inconclusive\+\+/)
  })

  test('nothing is ever resent from here', () => {
    /*
     * An undelivered message is not a failed send. Retrying it spends a
     * credit to reach the same switched-off handset, and hides the fact that
     * somebody needs to be asked for a working number.
     */
    assert.ok(!/queueSMS|sendSMS|deliverSMS/.test(src), 'the reconciler sends messages')
    assert.ok(!/status: 'queued'|status: 'retrying'/.test(src), 'it puts messages back in the queue')
  })

  test('a failed read is not reported as nothing to do', () => {
    assert.match(src, /if \(error\) return \{ error:/)
  })

  test('and it stops before the platform stops it', () => {
    assert.match(src, /Date\.now\(\) - started > budget/)
  })
})

describe('the screen says what is true', () => {
  const route = codeOf('app/api/sms/delivery/route.ts')
  const page = codeOf('app/(portal)/admin/sms-delivery/page.tsx')
  const status = codeOf('lib/ui/status.ts')

  test('an accepted message is no longer called delivered', () => {
    assert.ok(!/Delivered to the network/.test(route),
      'the diagnosis still claims delivery for a message that was only accepted')
    assert.match(route, /case 'sent':[\s\S]{0,400}Accepted by Arkesel/)
    assert.match(status, /sent:\s*\{ label: 'Sent'/)
  })

  test('confirmed delivery and refusal are separate states', () => {
    assert.match(route, /case 'delivered':/)
    assert.match(route, /case 'undelivered':/)
    assert.match(status, /delivered:\s*\{ label: 'Delivered',\s*tone: 'success'/)
    assert.match(status, /undelivered:\s*\{ label: 'Not delivered', tone: 'danger'/)
  })

  test('both can be filtered for, which is how somebody finds them', () => {
    assert.match(route, /const FILTERABLE = \[[^\]]*'delivered'[^\]]*'undelivered'/)
    assert.match(page, /const FILTERS = \[[^\]]*'undelivered'[^\]]*\]/)
  })

  test('the counters count the right thing', () => {
    const health = codeOf('lib/notifications/sms.ts')
    assert.match(health, /count\('delivered'\)/)
    assert.match(health, /count\('undelivered'\)/)
    assert.match(page, /value: health\.delivered24h/)
    assert.match(page, /value: health\.undelivered24h/)
    assert.ok(!/label: 'Delivered \(24h\)', value: health\.sent24h/.test(page),
      'the Delivered tile still counts messages that were only accepted')
  })

  test('and a PIN reset can now be looked up at all', () => {
    /*
     * The direct send path wrote the whole provider response and not the id,
     * so every message that matters most — a PIN reset, a sign-in code, an
     * onboarding PIN — had no reference, and no reference means no way to ask
     * the provider anything about it.
     */
    const sms = codeOf('lib/integrations/sms.ts')
    assert.match(sms, /provider_message_id: results\[i\]\.providerMessageId \?\? null/)
  })
})

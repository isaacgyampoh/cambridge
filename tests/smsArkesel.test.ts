import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { normaliseRecipient } from '../lib/integrations/smsRecipient.ts'
import { BRAND } from '../lib/brand.ts'

/**
 * SMS IS ARKESEL, AND THERE IS ONE WAY TO SEND IT.
 */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the sender id is one value', () => {
  test('nothing reaches Arkesel with a second copy of it', () => {
    /*
     * It was written out in three places: BRAND.smsSender (what real messages
     * used), CONFIG.arkeselSenderId (what the diagnostic and the config
     * screen reported), and a hard-coded fallback behind that. They agreed,
     * but nothing made them.
     *
     * Drift here fails in the worst available way: the networks silently drop
     * messages from a sender id that is not registered, so there is no error
     * to find — and the screen built to check SMS would have reported the id
     * it used itself, not the one the messages actually went out with.
     */
    const literals: string[] = []
    for (const f of [...sourceFiles('app'), ...sourceFiles('lib')]) {
      if (f.endsWith('lib/brand.ts')) continue
      const src = codeOf(f)
      if (src.includes(`'${BRAND.smsSender}'`)) literals.push(f)
    }
    assert.deepEqual(literals, [],
      `The sender id is written out again in:\n  ${literals.join('\n  ')}\nUse BRAND.smsSender.`)
  })

  test('and it is short enough for Arkesel to accept', () => {
    // An alphanumeric sender id is capped at 11 characters. A longer one is
    // rejected, or worse, truncated by the network and dropped.
    assert.ok(BRAND.smsSender.length > 0 && BRAND.smsSender.length <= 11,
      `"${BRAND.smsSender}" is ${BRAND.smsSender.length} characters; Arkesel allows at most 11.`)
    assert.match(BRAND.smsSender, /^[A-Za-z0-9]+$/,
      'An alphanumeric sender id may not contain spaces or punctuation.')
  })
})

describe('there is one way to send an SMS', () => {
  test('only the transport module knows the Arkesel endpoint', () => {
    const owners: string[] = []
    for (const f of [...sourceFiles('app'), ...sourceFiles('lib')]) {
      if (codeOf(f).includes('sms.arkesel.com')) owners.push(f)
    }
    assert.deepEqual(owners.map(o => o.replace(/^.*?cambridge\//, '')), ['lib/integrations/sms.ts'],
      'Somewhere other than the transport is talking to Arkesel directly.')
  })

  test('the diagnostic exercises the real path rather than imitating it', () => {
    /*
     * A diagnostic that reimplements the thing it diagnoses can only tell you
     * about itself. With its own URL, headers, body and success test, it
     * would have gone on reporting "SMS sent successfully" through a real
     * sender that was completely broken.
     */
    const src = codeOf('app/api/test/sms/route.ts')
    assert.match(src, /deliverSMS\(/, 'The test route must call the real sender.')
    assert.ok(!src.includes('fetch('), 'The test route must not make its own request.')
    assert.ok(!src.includes('api-key'), 'The test route must not build its own headers.')
  })
})

describe('the diagnostic answers when SMS is NOT configured', () => {
  test('a missing API key is reported, not thrown', () => {
    /*
     * SECRETS.arkeselApiKey throws when ARKESEL_API_KEY is unset, and it was
     * read outside the try block — so on a deployment with no SMS configured,
     * which is exactly when somebody presses this, the answer was an
     * unhandled 500 instead of the reason.
     */
    const src = codeOf('app/api/test/sms/route.ts')
    assert.ok(!src.includes('SECRETS.arkeselApiKey'),
      'Reading the key here re-introduces the crash; deliverSMS reports it instead.')
    assert.match(src, /ARKESEL_API_KEY is not set/,
      'The operator must be told which variable to set.')
  })

  test('and says whether pressing it again could help', () => {
    const src = codeOf('app/api/test/sms/route.ts')
    assert.match(src, /permanent:/,
      'A permanent failure needs somebody to change something; a transient one is worth a retry.')
  })

  test('an unapproved sender id is named as the likely cause', () => {
    // The failure with no other symptom: the networks drop the message and
    // nothing is reported anywhere.
    assert.match(codeOf('app/api/test/sms/route.ts'), /not approved/)
  })

  test('it still requires a super admin', () => {
    const src = codeOf('app/api/test/sms/route.ts')
    assert.match(src, /session\.role !== 'super_admin'/)
    assert.match(src, /status: 403/)
  })
})

describe('a number is validated before Arkesel is asked', () => {
  test('the real forms are accepted and normalised', () => {
    for (const given of ['0201234567', '233201234567', '+233 20 123 4567', '+233201234567']) {
      assert.equal(normaliseRecipient(given), '233201234567', `rejected: ${given}`)
    }
  })

  test('a number that cannot be a Ghanaian mobile is refused', () => {
    /*
     * The diagnostic's own normaliser had no length check, so `0246` became
     * `233246` and was posted to Arkesel as a recipient — a request that
     * could only ever be rejected, charged for, or delivered nowhere.
     */
    for (const bad of ['0246', '12345', '', '23320123456789']) {
      assert.equal(normaliseRecipient(bad), null, `should have been refused: "${bad}"`)
    }
  })

  test('the diagnostic refuses it up front rather than attempting a send', () => {
    const src = codeOf('app/api/test/sms/route.ts')
    const check = src.indexOf('normaliseRecipient(phone)')
    const send = src.indexOf('await deliverSMS(')
    assert.ok(check > 0 && check < send, 'Validate before attempting the send.')
    assert.match(src, /is not a Ghanaian mobile number, so no message was attempted/)
  })
})

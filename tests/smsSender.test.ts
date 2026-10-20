import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const code = (p: string) => readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * The SMS sender id is the one setting whose wrong value fails SILENTLY.
 *
 * An id the provider has not approved is dropped by the networks: the send
 * returns success, nothing arrives, and nothing anywhere reports it. Which id
 * is approved is a fact about the Arkesel account rather than about this
 * codebase, so it must be correctable without a deploy.
 */
describe('the SMS sender id', () => {
  const sms = code('lib/integrations/sms.ts')
  const cfg = code('lib/config.server.ts')

  test('can be set from the environment', () => {
    assert.match(cfg, /arkeselSenderId\(\) \{ return optional\('ARKESEL_SENDER_ID'\) \}/)
    assert.match(sms, /sender: SECRETS\.arkeselSenderId \|\| BRAND\.smsSender/)
  })

  test('falls back to the registered default rather than to nothing', () => {
    // An empty sender is rejected outright; the brand value is the one that
    // was in use, so unset must mean "unchanged", not "blank".
    assert.match(sms, /\|\| BRAND\.smsSender/)
    assert.doesNotMatch(sms, /sender: SECRETS\.arkeselSenderId,/)
  })

  test('the default is still a real registered id, not a placeholder', () => {
    const brand = readFileSync('lib/brand.ts', 'utf8')
    const m = /smsSender: '([^']+)'/.exec(brand)
    assert.ok(m, 'no sender id in brand')
    assert.ok(m[1].length >= 3 && m[1].length <= 11,
      'Arkesel sender ids are at most 11 characters')
    assert.doesNotMatch(m[1], /local|test|changeme|xxx/i)
  })
})

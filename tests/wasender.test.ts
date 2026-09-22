import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  normaliseWasenderKey, keyFingerprint, classifyWasender, describeSessionStatus,
  isSessionStatus, redactWebhook, FAILURE_MESSAGE, SESSION_STATUSES, WASENDER_BASE,
} from '../lib/whatsapp/wasenderRules.ts'
import { canonicalGhanaMobile } from '../lib/phone.ts'

/**
 * WASENDERAPI: "INVALID API" WHILE THE SESSION IS CONNECTED.
 *
 * The bodies asserted below are the ones the live API returned on
 * 2026-09-22, probed with a deliberately fake key:
 *
 *   GET  /api/status            401 {"success":false,"message":"Session not found for the provided API key"}
 *   POST /api/send-message      401 {"success":false,"message":"invalid API key",…}
 *   GET  /api/on-whatsapp/{id}  401 {"success":false,"message":"invalid API key",…}
 *   GET  /api/whatsapp-sessions 401 {"success":false,"message":"This endpoint requires a valid personal access token."}
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const client = codeOf('lib/whatsapp/wasender.ts')
const statusRoute = codeOf('app/api/whatsapp/status/route.ts')
const instance = codeOf('app/api/whatsapp/instance/route.ts')
const screen = codeOf('app/(portal)/admin/whatsapp/page.tsx')
const send = codeOf('lib/integrations/whatsapp.ts')
const webhook = codeOf('app/api/webhooks/whatsapp/route.ts')

/* ══ THE CREDENTIAL ═══════════════════════════════════════════════════════ */

describe('a pasted key is cleaned before it is used', () => {
  const key = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'

  test('a trailing newline or spaces', () => {
    assert.equal(normaliseWasenderKey(`  ${key}\n`), key)
  })

  test('wrapping quotes', () => {
    assert.equal(normaliseWasenderKey(`"${key}"`), key)
    assert.equal(normaliseWasenderKey(`'${key}'`), key)
  })

  test('a "Bearer " prefix copied from the documentation', () => {
    assert.equal(normaliseWasenderKey(`Bearer ${key}`), key)
    assert.equal(normaliseWasenderKey(`Bearer token ${key}`), key)
    assert.equal(normaliseWasenderKey(`Authorization: Bearer ${key}`), key)
  })

  test('a line break in the middle from a wrapped paste', () => {
    assert.equal(normaliseWasenderKey('a1b2c3d4e5f6a1b2\nc3d4e5f6a1b2c3d4'), key)
  })

  test('the key itself is never altered', () => {
    assert.equal(normaliseWasenderKey(key), key)
    assert.equal(normaliseWasenderKey(''), '')
    assert.equal(normaliseWasenderKey(null), '')
  })

  test('every path that sends a key cleans it first', () => {
    for (const [name, src] of [['client', client], ['send', send], ['instance', instance], ['status', statusRoute]] as const) {
      assert.match(src, /normaliseWasenderKey/, `${name} uses a key without cleaning it`)
    }
  })
})

describe('the key is never exposed', () => {
  test('a fingerprint shows only the last four characters', () => {
    const fp = keyFingerprint('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')!
    assert.match(fp, /^••••c3d4 \(32 chars\)$/)
    assert.ok(!fp.includes('a1b2c3'), 'the start of the key must not be shown')
  })

  test('the status route returns a fingerprint, not the key', () => {
    // It used to return key.slice(0,6) + key.slice(-4).
    assert.ok(!/slice\(0, 6\)/.test(statusRoute))
    assert.match(statusRoute, /keyFingerprint\(/)
  })

  test('no response or log carries the key itself', () => {
    for (const [name, src] of [['client', client], ['status', statusRoute], ['instance', instance]] as const) {
      for (const line of src.split('\n').filter(l => /console\.|NextResponse\.json/.test(l))) {
        assert.ok(!/\bkey\b\s*[,}]|\$\{key\}|cred\.key/.test(line),
          `${name} may emit the key: ${line.trim().slice(0, 90)}`)
      }
    }
  })

  test('the browser never receives it — the data layer swaps it for a flag', () => {
    assert.match(codeOf('lib/data/policy.ts'), /out\.has_wasender_key = Boolean\(v\)/)
    assert.match(screen, /has_wasender_key/)
  })

  test('and the screen no longer depends on a column it never gets', () => {
    /*
     * The screen tested `s.wasender_api_key`, which the data layer strips —
     * so it was always empty: every line read "Connect" and the per-line Test
     * button never rendered at all.
     */
    assert.ok(!/s\.wasender_api_key/.test(screen))
  })

  test('webhook bodies are stored with credentials removed', () => {
    // Every WasenderAPI event carries the session key as sessionId.
    const event = { event: 'session.status', sessionId: 'SECRETKEY', data: { status: 'connected' } }
    const safe = redactWebhook(event) as any
    assert.equal(safe.sessionId, '[redacted]')
    assert.equal(safe.data.status, 'connected')
    assert.match(webhook, /raw: redactWebhook\(raw\)/)
  })

  test('nested credentials are removed too', () => {
    const safe = redactWebhook({ a: { api_key: 'x', token: 'y', keep: 1 } }) as any
    assert.equal(safe.a.api_key, '[redacted]')
    assert.equal(safe.a.token, '[redacted]')
    assert.equal(safe.a.keep, 1)
  })
})

/* ══ WHAT WENT WRONG IS NAMED ═════════════════════════════════════════════ */

describe('a failure is classified, not called "Invalid API"', () => {
  test('a session key WasenderAPI does not recognise', () => {
    assert.equal(classifyWasender(401, { success: false, message: 'invalid API key' }), 'auth')
    assert.equal(classifyWasender(401, { success: false, message: 'Session not found for the provided API key' }), 'auth')
    assert.equal(classifyWasender(401, { success: false, message: 'API key is required' }), 'auth')
  })

  test('a Personal Access Token pasted as the session key', () => {
    assert.equal(
      classifyWasender(401, { success: false, message: 'This endpoint requires a valid personal access token.' }),
      'personal_access_token')
    assert.match(FAILURE_MESSAGE.personal_access_token, /not the session API key/)
  })

  test('a disconnected session', () => {
    assert.equal(classifyWasender(422, { success: false, message: 'Session is not connected' }), 'session_not_connected')
  })

  test('a plan or permission refusal is not an authentication failure', () => {
    assert.equal(classifyWasender(403, { success: false, message: 'No active subscription' }), 'subscription')
  })

  test('a rate limit', () => {
    assert.equal(classifyWasender(429, { success: false, message: 'Too many requests' }), 'rate_limited')
  })

  test('a malformed payload', () => {
    assert.equal(classifyWasender(422, { success: false, message: 'Validation failed', errors: { to: ['required'] } }), 'validation')
  })

  test('a provider fault', () => {
    assert.equal(classifyWasender(500, { message: 'Server error' }), 'provider')
  })

  test('success is success', () => {
    assert.equal(classifyWasender(200, { status: 'connected' }), null)
    assert.equal(classifyWasender(200, { success: true, data: { exists: true } }), null)
  })

  test('a 200 that says success:false is still a failure', () => {
    assert.notEqual(classifyWasender(200, { success: false, message: 'invalid API key' }), null)
  })

  test('every kind has a message a person can act on', () => {
    for (const [kind, text] of Object.entries(FAILURE_MESSAGE)) {
      assert.ok(text.length > 20, `${kind} has no usable message`)
      assert.ok(!/invalid api\b/i.test(text) || kind === 'auth', `${kind} still says "Invalid API"`)
    }
  })
})

/* ══ SESSION STATUS ═══════════════════════════════════════════════════════ */

describe('all seven documented statuses are mapped', () => {
  for (const s of SESSION_STATUSES) {
    test(s, () => {
      const d = describeSessionStatus(s)
      assert.ok(d.label && d.action.length > 10)
      assert.ok(isSessionStatus(s))
    })
  }

  test('connected is the only success tone', () => {
    assert.equal(describeSessionStatus('connected').tone, 'success')
    assert.equal(describeSessionStatus('need_scan').label, 'Needs QR scan')
    assert.equal(describeSessionStatus('logged_out').tone, 'danger')
  })

  test('an unknown value is not guessed', () => {
    assert.equal(describeSessionStatus('banana').label, 'Not checked')
    assert.ok(!isSessionStatus('banana'))
  })

  test('status is read from WasenderAPI, not from the database', () => {
    assert.match(client, /call\(key, 'GET', '\/api\/status'\)/)
    assert.match(statusRoute, /sessionStatus\(/)
  })

  test('the screen no longer writes the status itself', () => {
    // It sent status: 'connecting' on save, which is why a line sat at
    // Connecting for ever.
    assert.ok(!/status: 'connecting'/.test(screen))
    assert.ok(!/status\b/.test(instance.slice(instance.indexOf('const { staffId, apiKey, number }'), instance.indexOf('const update'))))
  })

  test('the documented base URL is used', () => {
    assert.equal(WASENDER_BASE, 'https://www.wasenderapi.com')
  })
})

/* ══ THE ENDPOINTS ════════════════════════════════════════════════════════ */

describe('the documented endpoints, with Bearer authentication', () => {
  test('status, contact check and send', () => {
    assert.match(client, /'\/api\/status'/)
    assert.match(client, /`\/api\/on-whatsapp\/\$\{encodeURIComponent\(`\+\$\{number\}`\)\}`/)
    assert.match(client, /'\/api\/send-message'/)
  })

  test('the header is exactly one Bearer', () => {
    assert.match(client, /Authorization: `Bearer \$\{key\}`/)
    assert.ok(!/Bearer Bearer/.test(client))
  })

  test('a refused key is re-checked against the account endpoint to name it', () => {
    assert.match(client, /if \(r\.kind === 'auth'\)[\s\S]{0,200}'\/api\/whatsapp-sessions'/)
  })

  test('every call has a timeout', () => {
    assert.match(client, /AbortSignal\.timeout\(TIMEOUT_MS\)/)
  })
})

describe('the number sent to WasenderAPI', () => {
  test('Ghana numbers become one canonical form', () => {
    for (const input of ['0241234567', '+233241234567', '233241234567', '024 123 4567', '00233241234567']) {
      assert.equal(canonicalGhanaMobile(input), '233241234567')
    }
  })

  test('the client normalises before it calls', () => {
    assert.match(client, /const number = canonicalGhanaMobile\(rawPhone\)/)
  })

  test('a number that is not a Ghanaian mobile is refused before the call', () => {
    assert.match(client, /kind: 'invalid_recipient'[\s\S]{0,200}not a valid Ghanaian mobile/)
  })

  test('no second normaliser was written for this', () => {
    assert.ok(!/replace\(\/\^0\/, '233'\)/.test(client + statusRoute + instance))
  })
})

/* ══ TEST NUMBER ══════════════════════════════════════════════════════════ */

describe('Test number performs a real API call', () => {
  test('check asks WasenderAPI whether the number is on WhatsApp', () => {
    assert.match(statusRoute, /checkContact\(cred\.key, phone\)/)
    assert.match(client, /exists: r\.body\?\.data\?\.exists === true/)
  })

  test('send sends a real message and returns the provider id', () => {
    assert.match(statusRoute, /sendText\(cred\.key, phone/)
    assert.match(client, /messageId = d\.msgId \?\? d\.messageId \?\? d\.id/)
  })

  test('it is not a check that the key field is merely filled in', () => {
    assert.ok(!/key\.length > 0 \?/.test(statusRoute))
    assert.match(statusRoute, /credentialFor\(staffId \|\| null\)/)
  })

  test('the test says which credential it used', () => {
    // It always used the server's central key, never the one entered here.
    assert.match(statusRoute, /cred\.source === 'line' \? 'this line/)
    assert.match(screen, /Used \$\{d\.via\}/)
  })

  test('the result is recorded with endpoint, status, id and time', () => {
    assert.match(statusRoute, /endpoint: '\/api\/send-message'/)
    assert.match(statusRoute, /action: 'whatsapp\.test_message'/)
    assert.match(statusRoute, /messageId: r\.ok \? r\.messageId : null/)
  })
})

/* ══ SAVING A KEY ═════════════════════════════════════════════════════════ */

describe('a key is verified before it is trusted', () => {
  test('the save checks it against WasenderAPI', () => {
    assert.match(instance, /const live = await sessionStatus\(key\)/)
  })

  test('a key WasenderAPI refuses is not saved', () => {
    assert.match(instance, /if \(!live\.ok && \(live\.kind === 'auth' \|\| live\.kind === 'personal_access_token'\)\)/)
    assert.match(instance, /return NextResponse\.json\(\{ error: live\.message, kind: live\.kind \}, \{ status: 400 \}\)/)
  })

  test('a newly saved key is the one used immediately afterwards', () => {
    // Read from the row on every call; nothing caches a credential.
    assert.match(client, /from\('profiles'\)[\s\S]{0,120}\.eq\('id', profileId\)/)
    assert.ok(!/cache|memo/i.test(client.slice(client.indexOf('export async function credentialFor'), client.indexOf('export type StatusResult'))))
  })

  test('the central key is only the fallback, never the default for a line', () => {
    assert.match(client, /if \(profileId\) \{/)
    assert.match(client, /source: 'central'/)
  })
})

/* ══ THE LIVE SEND PATH ═══════════════════════════════════════════════════ */

describe('an ordinary message send', () => {
  test('cleans the key it found', () => {
    assert.match(send, /normaliseWasenderKey\(data\?\.wasender_api_key as string \| null\)/)
    assert.match(send, /normaliseWasenderKey\(SECRETS\.wasenderApiKey\)/)
  })

  test('a bad recipient no longer marks the whole line disconnected', () => {
    /*
     * Every failure used to write wasender_status: 'disconnected', so one
     * mistyped lead number could take a working line off the screen.
     */
    assert.ok(!/status === 'sent' \? 'connected' : 'disconnected'/.test(send))
    assert.match(send, /kind === 'auth' \? 'invalid_key'/)
    assert.match(send, /kind === 'session_not_connected' \? 'disconnected'/)
    assert.match(send, /if \(next\) \{/)
  })
})

/* ══ WEBHOOK ══════════════════════════════════════════════════════════════ */

describe('session.status events', () => {
  test('are handled and matched to their line by the session key', () => {
    assert.match(webhook, /if \(eventName === 'session\.status'\)/)
    assert.match(webhook, /normaliseWasenderKey\(l\.wasender_api_key as string\) === sessionKey/)
  })

  test('only documented statuses are stored', () => {
    assert.match(webhook, /isSessionStatus\(status\) && sessionKey/)
  })

  test('a session no line holds is recorded as the central one', () => {
    assert.match(webhook, /wasender_central_status/)
  })
})

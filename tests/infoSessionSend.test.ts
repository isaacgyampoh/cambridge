import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normaliseRecipient } from '../lib/integrations/smsRecipient.ts'

/**
 * THE INFORMATION SECTION SENT NOTHING.
 *
 * ── WHAT WAS REPORTED ──────────────────────────────────────────────────────
 *
 * The Admissions team opened the Information section, chose SMS, filled it in,
 * pressed send, and nothing went out.
 *
 * ── WHAT WAS WRONG, IN ORDER OF HOW MUCH IT MATTERED ───────────────────────
 *
 *   1. The route refused them. Three layers — the portal catalogue, the API
 *      path guard and the sidebar — all admit anybody holding grp_automation.
 *      The handlers checked a hardcoded list of two ROLES. An admissions
 *      officer saw the section, used it, and got 401 on every request. The
 *      only visible symptom was a toast reading "unauth", and the list of
 *      past sessions came back empty for the same reason.
 *
 *   2. A disconnected WhatsApp reported success. With no API key the sender
 *      records the message and returns true, so every lead counted as
 *      notified and the session marked itself sent having reached nobody.
 *
 *   3. One request messaged up to five thousand leads in sequence. The
 *      platform killed it part way through, leaving the session `scheduled`
 *      with some people already messaged — and the retry started from the top
 *      and messaged them again.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const route = codeOf('app/api/info-sessions/route.ts')
const preview = codeOf('app/api/info-sessions/preview/route.ts')
const attendance = codeOf('app/api/info-sessions/attendance/route.ts')
const broadcast = codeOf('lib/infoSessionBroadcast.ts')
const page = codeOf('app/(portal)/pm/info-sessions/page.tsx')

describe('who may use the Information section', () => {
  test('the portal decides, not a hardcoded pair of roles', () => {
    for (const [name, src] of [['route', route], ['preview', preview], ['attendance', attendance]] as const) {
      assert.match(src, /withGuard\(\{ portals: PORTALS \}/, `${name} is not guarded by the portal`)
      assert.ok(!/ALLOWED\s*=\s*\[/.test(src), `${name} still has its own role list`)
      assert.ok(!/'unauth'/.test(src), `${name} still answers with "unauth"`)
    }
  })

  test('and it is the same portal the page and the path already use', () => {
    /*
     * The three had to agree. They did — with each other, and not with the
     * handler, which is the only one a person actually hits.
     */
    const portals = readFileSync('lib/access/portals.ts', 'utf8')
    const api = readFileSync('lib/access/apiAccess.ts', 'utf8')
    assert.match(portals, /grp_automation: \['\/pm\/info-sessions'/)
    assert.match(api, /'\/api\/info-sessions':\s*\['grp_automation'\]/)
    assert.match(route, /const PORTALS = \['grp_automation'\]/)
  })

  test('a session with no channel at all is refused when it is created', () => {
    // Every channel can be switched off in the form. Saved, it would sit
    // scheduled for ever and send nothing.
    assert.match(route, /Choose at least one way to send it/)
  })

  test('the send has room to finish', () => {
    // The platform default is ten to fifteen seconds.
    assert.match(route, /export const maxDuration = 60/)
  })
})

describe('what counts as having reached somebody', () => {
  test('a channel is used only if it can actually send', () => {
    /*
     * The recorder trap. With no key, sendWhatsAppText keeps the message and
     * returns true — so the count was of messages RECORDED, not delivered.
     */
    assert.match(broadcast, /whatsapp: wanted\.includes\('whatsapp'\) && whatsappConnected\(\)/)
    assert.match(broadcast, /sms: wanted\.includes\('sms'\) && smsConnected\(\)/)
    assert.match(broadcast, /email: wanted\.includes\('email'\) && emailConfigured\(\)/)
  })

  test('and if none of them can, it says so instead of marking itself sent', () => {
    assert.match(broadcast, /None of the channels chosen/)
    assert.match(broadcast, /so nothing was sent and the session is still scheduled/)
  })

  test('the figures are kept apart', () => {
    /*
     * Reached, queued, failed, unreachable and pending are five different
     * facts. Reporting them as one number is what let "Sent to 212 leads"
     * describe a session nobody received.
     */
    for (const field of ['leads_notified', 'queued', 'failed: failedSends', 'unreachable', 'pending']) {
      assert.ok(broadcast.includes(field), `the result does not report ${field}`)
    }
  })

  test('the screen shows them apart too', () => {
    assert.match(page, /reached/)
    assert.match(page, /queued/)
    assert.ok(!/Sent to \$\{d\.leads_notified\} leads/.test(page),
      'the screen still calls the raw count "sent"')
  })
})

describe('sending twice does not message anybody twice', () => {
  test('every text carries a key of its own', () => {
    /*
     * One per lead per session. A run that was cut short can be repeated and
     * picks up only the people it never reached.
     */
    assert.match(broadcast, /dedupeKey: `info_session:\$\{s\.id\}:\$\{lead\.id\}`/)
    assert.match(broadcast, /kind: 'info_session'/)
    assert.match(broadcast, /entityId: s\.id/)
  })

  test('a duplicate is treated as already reached, not as a failure', () => {
    assert.match(broadcast, /else if \(res\.duplicate\) reached = true/)
  })

  test('it goes through the queue, which retries', () => {
    // sendSMS makes one attempt and forgets. The queue keeps the row.
    assert.match(broadcast, /await queueSMS\(\{/)
    assert.ok(!/await sendSMS\(/.test(broadcast), 'still sending outside the queue')
  })

  test('a run that runs out of time leaves the session to be continued', () => {
    assert.match(broadcast, /const DEADLINE = Date\.now\(\) \+ 45_000/)
    assert.match(broadcast, /if \(Date\.now\(\) > DEADLINE\) \{ pending\+\+; continue \}/)
    assert.match(broadcast, /status: complete \? 'sent' : 'scheduled'/)
  })
})

describe('numbers that cannot be dialled are named, not dropped', () => {
  test('the operator is told which ones to correct', () => {
    /*
     * The collected list has to be the one returned. `badNumbers: []` in the
     * result keeps the name and reports nothing, which a search for the word
     * cannot tell apart from working.
     */
    assert.match(broadcast, /badNumbers\.push\(/, 'nothing is collected')
    assert.match(broadcast, /^\s*badNumbers,$/m, 'the collected list is not the one returned')
    assert.match(page, /need correcting/)
    assert.match(page, /d\.badNumbers\?\.length/)
  })

  test('the Ghanaian spellings all reach the same number', () => {
    /*
     * The four forms a spreadsheet, a form and a person all produce. They are
     * one phone, and the sender has to see them as one.
     */
    const expected = '233244721555'
    for (const form of [
      '0244721555', '233244721555', '+233244721555',
      '+233 24 472 1555', '024-472-1555', '(024) 472 1555', '00233244721555',
    ]) {
      assert.equal(normaliseRecipient(form), expected, `${form} did not normalise`)
    }
  })

  test('a bare nine digits is refused here, and that is deliberate', () => {
    /*
     * `244721555` has no 0 and no country code. The IMPORT accepts it, because
     * Excel eats the leading zero off a phone column and the alternative is
     * throwing away real people — and it stores the canonical form, so what
     * lands in the database is dialable either way.
     *
     * The SENDER is stricter on purpose. By the time a number reaches Arkesel
     * it has been through a writer that should have canonicalised it, so nine
     * bare digits means something else went wrong, and guessing a country
     * code onto it would post a request that delivers nowhere and is then
     * retried.
     */
    assert.equal(normaliseRecipient('244721555'), null)
  })

  test('054 and the other networks too', () => {
    assert.equal(normaliseRecipient('0541234567'), '233541234567')
    assert.equal(normaliseRecipient('0201234567'), '233201234567')
    assert.equal(normaliseRecipient('0501234567'), '233501234567')
  })

  test('and something that is not a number is refused rather than guessed at', () => {
    for (const bad of ['', '12345', 'not a number', '0244', null, undefined]) {
      assert.equal(normaliseRecipient(bad as string), null, `${bad} was accepted`)
    }
  })
})

/**
 * ─── CREATING ONE AND SENDING IT, IN ONE ACTION ─────────────────────────────
 *
 * Scheduling was the only way in: fill the form, choose a time for it to
 * auto-send, save it, then find the row in the list and press Send. For an
 * invitation going out now anyway that is three steps — and the auto-send
 * time was REQUIRED, so somebody sending immediately still had to invent one.
 */
describe('a session can send the moment it is created', () => {
  test('the route takes send_now and uses now as the send time', () => {
    assert.match(route, /const sendNow = send_now === true/)
    assert.match(route, /const notifyAt = sendNow \? new Date\(\)\.toISOString\(\) : notify_at/)
  })

  test('and does not demand an auto-send time for it', () => {
    /*
     * "When should it auto-send?" has an obvious answer when the button says
     * Send now, and making somebody fill it in anyway was the friction.
     */
    assert.ok(!/!title\?\.trim\(\) \|\| !link\?\.trim\(\) \|\| !scheduled_at \|\| !notify_at/.test(route),
      'the auto-send time is still required for every session')
    assert.match(route, /if \(!notifyAt\)/)
  })

  test('it is saved before anything is sent', () => {
    /*
     * A send that fails half way through must leave a session that can be
     * continued from the list, not invitations that reached some people and
     * no record at all.
     */
    const insert = route.indexOf("from('info_sessions').insert({")
    const send = route.indexOf('broadcastInfoSession(data.id)')
    assert.ok(insert > -1 && send > insert, 'the send happens before the row exists')
  })

  test('and a failed send says the session was still kept', () => {
    assert.match(route, /The session is saved, so you can send it from the list/)
  })

  test('it is the same send the button and the runner use', () => {
    // One behaviour, not three implementations of it.
    assert.match(route, /const \{ broadcastInfoSession \} = await import\('@\/lib\/infoSessionBroadcast'\)/)
    const runner = codeOf('app/api/info-sessions/run/route.ts')
    assert.match(runner, /broadcastInfoSession\(s\.id\)/)
  })

  test('the form offers both', () => {
    assert.match(page, /onClick=\{\(\) => create\(true\)\}/)
    assert.match(page, /onClick=\{\(\) => create\(false\)\}/)
  })

  test('and it confirms before it blasts', () => {
    /*
     * The CONDITION, not the words inside it. `if (false && !await confirm(…))`
     * leaves the whole dialog in the file, question and warning and all, and
     * asks nobody.
     */
    assert.match(page, /if \(sendNow && !await confirm\(\{/)
    assert.match(page, /Create and send it now\?/)
    assert.match(page, /cannot be recalled/)
  })

  test('both paths report an outcome the same way', () => {
    /*
     * Two reporters would drift, and the one that drifts is the one that
     * says "sent" about a session nobody received.
     */
    assert.match(page, /function reportSend\(/)
    assert.match(page, /if \(sendNow && d\.sent\) reportSend\(d\)/)
    assert.match(page, /reportSend\(d, 'sn'\)/)
  })

  test('a session with no channel is refused before it is saved', () => {
    assert.match(page, /Choose at least one way to send it/)
    assert.match(route, /Choose at least one way to send it/)
  })
})

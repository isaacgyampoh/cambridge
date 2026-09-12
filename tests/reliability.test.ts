import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * FAILING SAFELY.
 *
 * Three bugs in this system have had the same shape: a failure that produced
 * a normal-looking result. A missing column made a statement fail as a unit
 * and every assignment SMS stopped. A column nothing writes made the fee
 * loader return nothing, and the assistant was asked about price with no
 * prices in front of it. An insert error made every incoming message look
 * like a retry, and leads went unanswered.
 *
 * None of them raised anything. Each looked, from the outside, exactly like
 * the system working and there being nothing to do.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('a load failure is never an empty result', () => {
  /*
   * Section 39 of the brief: the assistant must not read "the database is
   * unreachable" as "there are no programmes". Those lead to opposite
   * behaviour — one is a question to ask, the other is a conversation to hand
   * to a person.
   */
  test('loadProgrammes reports failure rather than returning nothing', () => {
    const src = codeOf('lib/chatbot/programme.ts')
    assert.match(src, /Promise<LoadResult<Programme\[\]>>/,
      'the loader can still return an empty array for a failed read')
    assert.match(src, /return \{ ok: false, error: minimal\.error\.message \}/)
    assert.match(src, /return \{ ok: true, data: \[\] \}/,
      'an empty centre must still be reportable as a success')
  })

  test('loadKnowledge does the same', () => {
    const src = codeOf('lib/chatbot/knowledge.ts')
    assert.match(src, /Promise<LoadResult<KnowledgeBlocks>>/)
    assert.match(src, /return \{ ok: false, error: kbErr\.message \}/)
  })

  test('the context carries the difference rather than flattening it', () => {
    const src = codeOf('lib/chatbot/context.ts')
    assert.match(src, /programmesUnavailable: !loaded\.ok/,
      'a failed programme read is indistinguishable from a centre with none')
  })

  test('and the assistant hands over on a failed read', () => {
    const src = codeOf('lib/chatbot/index.ts')
    assert.match(src, /if \(ctx\.programmesUnavailable\)/,
      'the assistant carries on conversing with no programme data')
    assert.match(src, /if \(!loadedKnowledge\.ok\)/)
    // Both must escalate, not merely fall quiet.
    const block = src.slice(src.indexOf('ctx.programmesUnavailable'), src.indexOf('const knowledge ='))
    assert.match(block, /handoff: 'no_knowledge'/)
  })

  test('the readiness check separates a failed read from an empty table', () => {
    const src = codeOf('app/api/admin/chatbot-check/route.ts')
    assert.match(src, /programmesFailed/,
      'the check cannot tell an unreachable database from a centre with no courses')
    assert.match(src, /read successfully and holds no active programmes/,
      'an empty table is reported with the same words as a broken read')
  })
})

describe('a retry is a retry, and nothing else is', () => {
  /*
   * `return !!error` treated ANY insert failure as "already seen" — the table
   * missing, a policy refusing the write, the database briefly unreachable.
   * Each made every incoming message look like a duplicate, so the webhook
   * returned early and the lead was never answered, silently, for as long as
   * it lasted.
   */
  const src = codeOf('lib/messageJobs.ts')

  test('only a unique violation counts as already processed', () => {
    assert.match(src, /error\.code === '23505'/,
      'any database error is being read as a duplicate again')
    assert.match(src, /duplicate key\|unique constraint/)
  })

  test('an unrecognised failure processes the message rather than dropping it', () => {
    assert.match(src, /processing it rather than dropping it/,
      'a transient error silently drops the message')
    // Answering twice is a bad day; never answering is a lost lead.
    const tail = src.slice(src.indexOf('if (duplicate) return true'))
    assert.match(tail, /return false/)
  })
})

describe('the WhatsApp webhook is not an open door', () => {
  /*
   * It was. The comment claimed a signature was recorded but never rejected
   * on; no check of any kind existed, and WASENDER_WEBHOOK_SECRET was read in
   * config and used nowhere.
   *
   * A POST to that URL could create a lead, spend model credit, inject text
   * into a conversation, and make the centre's own WhatsApp line send
   * messages to any number the caller named.
   */
  const src = codeOf('app/api/webhooks/whatsapp/route.ts')

  test('the configured secret is actually checked', () => {
    assert.match(src, /SECRETS\.wasenderWebhookSecret/,
      'the webhook secret is configured and still unused')
    assert.match(src, /return NextResponse\.json\(\{ ok: false, error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  test('the comparison is constant time', () => {
    // Otherwise the endpoint leaks the secret a character at a time to
    // anybody measuring how long it takes to say no.
    assert.match(src, /timingSafeEqual/)
    assert.match(src, /a\.length === b\.length/,
      'timingSafeEqual throws on a length mismatch, so the lengths must be compared first')
  })

  test('it accepts the secret the ways a provider can actually send it', () => {
    for (const how of ['x-webhook-secret', 'authorization', "searchParams.get('secret')"]) {
      assert.ok(src.includes(how), `the secret cannot be supplied via ${how}`)
    }
  })

  test('no signature scheme is invented', () => {
    /*
     * This repository cannot verify WaSender's signing algorithm. Guessing at
     * one would either reject every real delivery or accept every forged one.
     */
    assert.ok(!/createHmac|sha256.*signature/i.test(src),
      'an HMAC scheme has been invented for a provider whose scheme is unknown')
  })

  test('an unset secret leaves the line working, and says so', () => {
    // Turning the gate on by deploying would silence a live WhatsApp line the
    // moment it shipped, which is a worse outage than the exposure.
    assert.match(src, /if \(!expected\)/)
    assert.match(src, /OPEN — WASENDER_WEBHOOK_SECRET is not set/)
  })

  test('and the exposure is reported where an administrator will see it', () => {
    const check = codeOf('app/api/admin/chatbot-check/route.ts')
    assert.match(check, /id: 'webhook', label: 'Webhook protection'/)
    assert.match(check, /status: 'fail'/)
  })

  test('a rejected request is recorded', () => {
    // A webhook that has started being rejected looks exactly like one that
    // has stopped being called, and the fix for those two is opposite.
    assert.match(src, /outcome: 'rejected'/)
  })
})

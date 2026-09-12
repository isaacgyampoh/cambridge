import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ownerOfLine, isKnownLine, type MarketerLine } from '../lib/whatsapp/lineOwnerRules.ts'
import { parseInbound } from '../lib/parseInbound.ts'

/**
 * A MESSAGE NAMES TWO PEOPLE, NOT ONE.
 *
 * Every marketer connects their own WhatsApp number, so an inbound message
 * carries the prospect who sent it AND the marketer they chose to send it to.
 * Only the sender was ever read.
 *
 * So somebody who deliberately messaged Ruth's number was handed to the
 * weighted lottery like an anonymous web form, and could be given to any
 * marketer at all — who then answered, in their own voice, from their own
 * line. The prospect messaged Ruth and a stranger replied; Ruth never saw the
 * lead she had earned; and the lottery, which exists to share out leads that
 * belong to nobody, was being applied to one that was never anonymous.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const RUTH = '233241234567'
const KOFI = '233209876543'

const LINES: MarketerLine[] = [
  { id: 'ruth-id', line: '0241234567' },     // stored in a different spelling
  { id: 'kofi-id', line: '233209876543' },
]

describe('the line a message arrives on identifies the marketer', () => {
  test('a message to Ruth’s line belongs to Ruth', () => {
    assert.equal(ownerOfLine(RUTH, LINES), 'ruth-id')
  })

  test('and a message to Kofi’s line belongs to Kofi', () => {
    assert.equal(ownerOfLine(KOFI, LINES), 'kofi-id')
  })

  test('however the two numbers happen to be spelled', () => {
    // Ruth's line is on file as 0241234567; the provider reports 233241234567.
    // A match that only compares the stored spelling finds nothing and sends
    // the lead to the lottery — which is the whole bug, one layer down.
    for (const spelling of ['0241234567', '233241234567', '+233 24 123 4567', '00233241234567']) {
      assert.equal(ownerOfLine(spelling, LINES), 'ruth-id', `${spelling} did not resolve to Ruth`)
    }
  })
})

describe('and when it does not, it says so rather than guessing', () => {
  test('a provider that did not name the line gives nobody', () => {
    assert.equal(ownerOfLine(null, LINES), null)
  })

  test('a number no marketer has connected gives nobody', () => {
    assert.equal(ownerOfLine('233200000000', LINES), null)
    assert.equal(isKnownLine('233200000000', LINES), false)
  })

  test('a line two marketers both claim gives nobody', () => {
    /*
     * Somebody mistyped a profile. Picking the first would credit a marketer
     * for a lead that may well be their colleague's — and silently, which is
     * how a commission dispute starts. Null falls through to the ordinary
     * assignment rules, which is the safe direction to be wrong in.
     */
    const clashing: MarketerLine[] = [
      { id: 'ruth-id', line: '0241234567' },
      { id: 'ama-id', line: '233241234567' },
    ]
    assert.equal(ownerOfLine(RUTH, clashing), null)
    // But it IS a line we know about — that distinction is what gets logged.
    assert.equal(isKnownLine(RUTH, clashing), true)
  })

  test('a deactivated marketer does not collect leads', () => {
    const gone: MarketerLine[] = [{ id: 'ruth-id', line: '0241234567', active: false }]
    assert.equal(ownerOfLine(RUTH, gone), null)
  })
})

describe('the receiving line is read off the payload', () => {
  test('from the shapes providers actually use', () => {
    for (const payload of [
      { instanceId: '233241234567', from: '233555000111', text: 'hi' },
      { session: '233241234567', data: { from: '233555000111', messageBody: 'hi' } },
      { data: { owner: '233241234567@s.whatsapp.net', from: '233555000111', conversation: 'hi' } },
      { displayPhoneNumber: '233241234567', from: '233555000111', text: 'hi' },
    ]) {
      const got = parseInbound(payload)
      assert.equal(got.receivedOn, '233241234567',
        `receivedOn missing from ${JSON.stringify(payload)}`)
      assert.equal(got.phone, '233555000111', 'the sender must still be read correctly')
    }
  })

  test('a payload that names no line leaves it null', () => {
    assert.equal(parseInbound({ from: '233555000111', text: 'hi' }).receivedOn, null)
  })

  test('the lead’s own number is never mistaken for one of ours', () => {
    /*
     * On an outbound echo the provider puts the LEAD's number in `to` and
     * `recipient`. Reading those as the receiving line would file the
     * conversation under the prospect's own number as though the centre had
     * connected it — and every provider sends those echoes.
     */
    const echo = { fromMe: true, to: '233555000111', recipient: '233555000111', text: 'hello' }
    assert.equal(parseInbound(echo).receivedOn, null)
  })
})

describe('the webhook acts on it', () => {
  const src = codeOf('app/api/webhooks/whatsapp/route.ts')

  test('a new lead is offered to the marketer whose line was messaged', () => {
    assert.match(src, /preferredMarketerId: lineOwner/,
      'intakeLead was called without it, so every WhatsApp lead went to the lottery.')
  })

  test('and the line is only looked up when a lead is about to be created', () => {
    /*
     * An existing lead's owner is settled by the ERP's assignment rules. A
     * message arriving on a second line must not move a colleague's lead.
     */
    assert.match(src, /if \(!lead\?\.id && parsed\.receivedOn\)/,
      'The lookup must be gated on there being no lead yet.')
  })

  test('a failed read falls through instead of turning the enquiry away', () => {
    assert.match(src, /if \(linesFailed\)/)
    assert.match(src, /line_lookup_failed/,
      'It must be recorded — leads arriving meanwhile go to the wrong marketer.')
  })

  test('a line nobody has connected is recorded', () => {
    assert.match(src, /unknown_line/,
      'Usually a marketer changed their number and their profile still holds the old one.')
  })
})

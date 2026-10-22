import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { channelsFor, otpSmsText, undeliverableMessage } from '../lib/auth/otpChannels.ts'
import { maskPhone } from '../lib/ui/contact.ts'

/**
 * A CODE NOBODY COULD RECEIVE.
 *
 * ── HOW THIS WAS FOUND ─────────────────────────────────────────────────────
 *
 * The owner asked whether a PIN reset could be sent by SMS. Reading the three
 * paths that issue a code — sign-in, resend, and recovery — all three called
 * sendOTPEmail and nothing else. Email was not the preferred channel; it was
 * the only one.
 *
 * At that moment the campus mailbox had no password configured, so email
 * could not send at all, while the SMS account was funded and working. Every
 * active member of staff had both a number and an address on file. So the
 * state of the system was: seventeen people who, on entering the correct PIN,
 * would be shown a code screen and wait at it forever — and one super admin,
 * exempt from codes, who could still get in.
 *
 * Nobody had reported it, because nobody had needed to sign in since the
 * mailbox was cut over.
 *
 * ── WHAT THESE PIN ──────────────────────────────────────────────────────────
 *
 * That a channel is offered only when it can actually carry a message: a
 * destination on the account AND a configured sender. Anything else is how
 * somebody ends up at a code screen no code is coming to. And that being
 * unreachable refuses the sign-in rather than skipping the second factor —
 * which is the opposite mistake, and the more expensive one.
 */

const BOTH = { smsReady: true, emailReady: true }
const PERSON = { phone: '0241234567', email: 'ama@cambridge.edu.gh', full_name: 'Ama Mensah' }

describe('which channels a code can travel on', () => {
  test('SMS comes first when both are possible', () => {
    /*
     * The code is read off a phone already in the person's hand, it arrives
     * in seconds, and it does not land in a spam folder.
     */
    assert.deepEqual(channelsFor(PERSON, BOTH), ['sms', 'email'])
  })

  test('OTP_CHANNEL=email swaps them without a deploy', () => {
    // For whoever is paying per text: each code is a credit.
    assert.deepEqual(channelsFor(PERSON, { ...BOTH, prefer: 'email' }), ['email', 'sms'])
  })

  test('a channel with no destination on the account is not offered', () => {
    assert.deepEqual(channelsFor({ email: PERSON.email }, BOTH), ['email'])
    assert.deepEqual(channelsFor({ phone: PERSON.phone }, BOTH), ['sms'])
  })

  test('nor is one whose sender this deployment has not configured', () => {
    /*
     * This is the case that was live in production. Both destinations on
     * file, and the mailbox unusable: the answer must be SMS alone, not
     * "email, and hope".
     */
    assert.deepEqual(channelsFor(PERSON, { smsReady: true, emailReady: false }), ['sms'])
    assert.deepEqual(channelsFor(PERSON, { smsReady: false, emailReady: true }), ['email'])
  })

  test('a preference never conjures a channel that cannot deliver', () => {
    /*
     * The subtle one. `prefer: 'email'` reorders what is POSSIBLE; a version
     * that puts email first unconditionally would send nothing at all on a
     * deployment whose mailbox is not configured — which is precisely the
     * deployment this was written on.
     */
    assert.deepEqual(
      channelsFor(PERSON, { smsReady: true, emailReady: false, prefer: 'email' }),
      ['sms'],
    )
    assert.deepEqual(
      channelsFor({ phone: PERSON.phone }, { ...BOTH, prefer: 'email' }),
      ['sms'],
    )
  })

  test('an unparseable number is not a channel', () => {
    /*
     * Judged by the SAME rule the SMS sender uses to dial, so the two cannot
     * disagree about whether a number is sendable. A number this rejects
     * would have been "sent" to nowhere.
     */
    assert.deepEqual(channelsFor({ phone: '12345', email: PERSON.email }, BOTH), ['email'])
    assert.deepEqual(channelsFor({ phone: '241234567' }, BOTH), [])
  })

  test('and an address with no @ is not one either', () => {
    assert.deepEqual(channelsFor({ email: 'ama', phone: PERSON.phone }, BOTH), ['sms'])
  })

  test('no destination at all is an empty list, not a default', () => {
    // The caller must refuse. Returning a channel here is how a missing
    // address became an OTP bypass in the first place.
    assert.deepEqual(channelsFor({}, BOTH), [])
    assert.deepEqual(channelsFor({ phone: null, email: null }, BOTH), [])
  })
})

describe('the text of the message', () => {
  const text = otpSmsText('481902', 'Ama Mensah')

  test('carries the code and says how long it lasts', () => {
    assert.match(text, /481902/)
    assert.match(text, /lasts/)
  })

  test('addresses the person by first name only', () => {
    assert.match(text, /^Ama, your/)
    assert.ok(!text.includes('Mensah'), 'a surname on a lock screen earns nothing')
    assert.match(otpSmsText('481902', null), /^Your /, 'and reads correctly with no name at all')
  })

  test('contains no link and asks for nothing', () => {
    /*
     * A code message that tells the reader to tap something teaches them to
     * act on code messages, which is the whole mechanism of the attack the
     * code exists to stop. It warns them not to share it, and stops.
     */
    assert.ok(!/https?:\/\//.test(text), 'no URL belongs in a sign-in code')
    assert.ok(!/\b(click|tap|verify here|confirm your)\b/i.test(text))
    assert.match(text, /Do not share it/)
  })

  test('is short enough to be one text', () => {
    // Over 160 characters an SMS is billed as two, and these go out all day.
    assert.ok(text.length <= 160, `the code message is ${text.length} characters`)
  })
})

describe('what the person is told when nothing can be sent', () => {
  test('an account with nothing on file is told to ask for one', () => {
    const m = undeliverableMessage({})
    assert.match(m, /no phone number or email/)
    assert.match(m, /administrator/)
    assert.ok(!/try again/i.test(m), 'retrying cannot help, so it must not be suggested')
  })

  test('a failed send is worth retrying, and says so', () => {
    const m = undeliverableMessage({ phone: '0241234567' })
    assert.match(m, /try again/i)
  })

  test('neither names a provider or a missing secret', () => {
    /*
     * This text reaches an unauthenticated screen. Which integrations a
     * deployment is missing is not something to publish to whoever is
     * guessing PINs at it.
     */
    for (const m of [undeliverableMessage({}), undeliverableMessage({ phone: '0241234567' })]) {
      assert.ok(!/arkesel|smtp|resend|api[ _]?key|password|secret/i.test(m), m)
    }
  })
})

describe('the destination shown on the code screen', () => {
  test('a number keeps its prefix and last four, and hides the rest', () => {
    assert.equal(maskPhone('0241234567'), '024 ••• 4567')
    assert.equal(maskPhone('+233241234567'), '024 ••• 4567')
  })

  test('and the full number never appears', () => {
    const masked = maskPhone('0241234567')
    assert.ok(!masked.includes('123'), 'the dialable middle must not be shown')
    assert.ok(!/\d{7}/.test(masked), 'nor any run long enough to be a number')
  })

  test('junk masks to a word rather than leaking what was stored', () => {
    assert.equal(maskPhone('12345'), 'your phone')
    assert.equal(maskPhone(null), 'your phone')
  })
})

/* ─────────────────────────────────────────────────────────────────────────── */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('every path that issues a code can use both channels', () => {
  const paths = {
    'sign-in': 'app/api/auth/verify-pin/route.ts',
    resend: 'app/api/auth/resend-otp/route.ts',
    recovery: 'app/api/auth/recover/start/route.ts',
  }

  for (const [name, path] of Object.entries(paths)) {
    test(`${name} sends through deliverOTP, not a single provider`, () => {
      const code = codeOf(path)
      assert.match(code, /deliverOTP\(/, `${name} must go through the channel chooser`)
      assert.ok(!/sendOTPEmail\(/.test(code),
        `${name} calls the mail sender directly, so it cannot text a code`)
    })

    test(`${name} does not claim the code was emailed`, () => {
      const code = codeOf(path)
      assert.ok(!/could not email|emailed to|check your email/i.test(code),
        `${name} tells the person about an email that may have been a text`)
    })
  }

  test('recovery asks for a phone OR an email, never email alone', () => {
    const recovery = codeOf('lib/auth/recovery.ts')
    assert.match(recovery, /!account\.email && !account\.phone/,
      'an account reachable by SMS was refused recovery outright')
    assert.match(recovery, /phone: account\.phone/,
      'the number has to reach the caller for the caller to text it')
  })
})

describe('a code that did not go anywhere is not reported as sent', () => {
  const lines = codeOf('lib/auth/otpDelivery.ts').split('\n')

  test('every sent:true is the body of a successful send', () => {
    /*
     * The one invariant of this file. `sent: true` because a channel was
     * ATTEMPTED is the stranded code screen in its original form: the caller
     * shows a code entry box, and the person waits at it for a message that
     * no provider ever accepted.
     *
     * Checked by position rather than by a window of characters, so it keeps
     * holding when the arguments on those lines change.
     */
    const claims = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /sent: true/.test(line))

    assert.ok(claims.length > 0, 'no success path left — deliverOTP can never report a send')

    for (const { line, i } of claims) {
      const previous = lines.slice(0, i).reverse().find(l => l.trim() !== '') ?? ''
      assert.match(previous, /if \(await send[A-Za-z]+\(/,
        `"${line.trim()}" is not guarded by a send that returned true`)
    }
  })

  test('and the fall-through says so plainly', () => {
    const last = lines.filter(l => /return \{ sent:/.test(l)).pop() ?? ''
    assert.match(last, /sent: false, via: null, hint: null/,
      'the end of the loop must report failure, not the last thing it tried')
  })

  test('a thrown sender costs that channel its turn, not the whole send', () => {
    /*
     * An HTTP client that throws on a timeout is the normal case, not an
     * exotic one. If that escapes the loop, a slow SMS gateway takes email
     * down with it and the person is told nothing could be sent — when the
     * fallback would have worked.
     *
     * Checked by position: the catch has to sit inside the loop, and nothing
     * between catching and marking the channel failed may return or rethrow,
     * or the next channel never gets its turn. Grepping for `catch` alone
     * passes on code that catches and then rethrows.
     */
    const at = (re: RegExp) => lines.findIndex(l => re.test(l))
    const loop = at(/for \(const channel of order\)/)
    const tried = at(/^\s*try \{/)
    const caught = at(/\} catch \(e\) \{/)
    const pushed = at(/^\s*failed\.push\(channel\)/)

    assert.ok(loop >= 0, 'the channels are no longer tried in turn')
    assert.ok(tried > loop, 'the try wraps the whole loop, so one throw ends every attempt')
    assert.ok(caught > tried, 'a caught failure is not recorded as one')
    assert.ok(pushed > caught, 'a caught failure is not recorded as one')
    assert.ok(!/\b(throw|return)\b/.test(lines.slice(caught, pushed).join('\n')),
      'a provider that throws aborts the fallback instead of yielding to it')
  })
})

describe('the sign-in guard and the sender agree', () => {
  const verifyPin = codeOf('app/api/auth/verify-pin/route.ts')

  test('both ask one function which senders are configured', () => {
    /*
     * Two separate readiness checks drift. If the guard believed email was
     * usable and the sender did not, the account would be admitted and then
     * sent nothing — the stranded code screen, reintroduced one layer up.
     */
    assert.match(verifyPin, /channelsFor\(profile, channelReadiness\(\)\)/)
    assert.ok(!/emailConfigured\(\)/.test(verifyPin),
      'the guard is asking its own question instead of the sender’s')
  })

  test('a failed delivery is reported, not swallowed', () => {
    assert.match(verifyPin, /if \(!delivery\.sent\)/)
    assert.match(verifyPin, /auth\.otp_send_failed/)
  })

  test('and the screen is told which channel was used', () => {
    assert.match(verifyPin, /sentVia: delivery\.via/)
    assert.match(verifyPin, /hint: delivery\.hint/)
  })
})

describe('the login screen says where the code went', () => {
  const form = codeOf('app/(auth)/login/LoginForm.tsx')

  test('it reads the channel from the response', () => {
    assert.match(form, /setSentVia\(d\.sentVia/)
    assert.match(form, /setCodeHint\(d\.hint/)
  })

  test('and never tells everyone to check their email', () => {
    /*
     * The failure this replaces is not an outage: it is a person refreshing
     * an inbox while the code sits unread on their lock screen.
     */
    assert.ok(!/to \{emailHint \|\| 'your email'\}/.test(form))
    assert.match(form, /sentTo\(sentVia, codeHint\)/)
  })

  test('a resend updates the destination too', () => {
    // Email can fail and SMS succeed on the retry. The screen has to follow.
    const resend = form.slice(form.indexOf('async function resendOtp'))
    const body = resend.slice(0, resend.indexOf('\n  }'))
    assert.match(body, /setSentVia\(/, 'the resend leaves a stale channel on screen')
  })
})

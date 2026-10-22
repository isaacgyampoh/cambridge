import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  channelsFor, otpSmsText, pinResetSmsText, undeliverableMessage,
} from '../lib/auth/otpChannels.ts'
import { maskPhone } from '../lib/ui/contact.ts'
import { readBalanceResponse } from '../lib/integrations/smsAccountCheck.ts'

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

/**
 * ─── A RESET THAT REACHES THE PERSON IT IS FOR ──────────────────────────────
 *
 * Resetting a colleague's PIN sent nothing at all. The administrator typed a
 * new PIN and the colleague found out when somebody remembered to tell them —
 * and if they had never signed in before, they did not know where the portal
 * was either.
 */
describe('the message that goes out when an administrator resets a PIN', () => {
  const URL = 'https://portal.cambridge.edu.gh'
  const text = pinResetSmsText('4821', 'Ama Mensah', URL)

  test('carries the new PIN and where to use it', () => {
    assert.match(text, /4821/)
    assert.ok(text.includes(URL), 'without the address, somebody new has nowhere to go')
  })

  test('says what to do next, and warns them off sharing it', () => {
    assert.match(text, /choose your own PIN/)
    assert.match(text, /Do not share/)
  })

  test('first name only, and reads correctly without one', () => {
    assert.match(text, /^Ama, your/)
    assert.ok(!text.includes('Mensah'))
    assert.match(pinResetSmsText('4821', null, URL), /^Your portal PIN/)
  })

  test('fits in one text', () => {
    // 160 characters, including the address. Two texts is two credits and a
    // PIN split across them.
    assert.ok(text.length <= 160, `the reset message is ${text.length} characters`)
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

    assert.equal(claims.length, 1,
      'there must be exactly one place that can claim a send — a second copy is a second chance to get it wrong')

    for (const { i } of claims) {
      // The nearest condition above it, whatever the line breaks look like.
      const guard = lines.slice(0, i).reverse().find(l => /\bif \(/.test(l)) ?? ''
      assert.match(guard, /if \(await send/,
        'the nearest condition above sent:true is not a send that returned true')
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

/**
 * ─── "CONFIGURED" IS NOT "WORKING" ─────────────────────────────────────────
 *
 * The readiness screen reported SMS as configured because ARKESEL_API_KEY had
 * a value. It did — a stale one, which the provider answered with
 * {"message":"Invalid key"} and an HTTP 200. Present and working are
 * different facts, and only the second one sends anything.
 *
 * It matters more now that it did: a sign-in code goes by SMS first, so a key
 * that is set and rejected locks out every member of staff who is not
 * OTP-exempt, while reporting itself as healthy.
 */
describe('reading the SMS provider’s answer', () => {
  test('a funded account reports its credits', () => {
    const v = readBalanceResponse(200, { status: 'success', data: { sms_balance: 300, main_balance: 'GHS 1078.929' } })
    assert.deepEqual(v, { accepted: true, credits: 300, error: null })
  })

  test('a rejected key is caught even though the status is 200', () => {
    /*
     * This is the exact body the provider returned for the key that was in
     * the environment. Judging the response by HTTP status alone would have
     * read it as a success with an unknown balance.
     */
    const v = readBalanceResponse(200, { message: 'Invalid key', status: 'error' })
    assert.equal(v.accepted, false)
    assert.match(String(v.error), /rejected this deployment/)
    assert.match(String(v.error), /cannot be sent by SMS/)
  })

  test('and by status when the provider uses one', () => {
    assert.equal(readBalanceResponse(401, {}).accepted, false)
    assert.equal(readBalanceResponse(403, {}).accepted, false)
  })

  test('an outage is INCONCLUSIVE, not a rejected key', () => {
    /*
     * The important one. A 502 says nothing about the credential, and
     * reporting it as invalid sends somebody rotating a working key in the
     * middle of what is already an incident.
     */
    for (const status of [500, 502, 503, 429]) {
      const v = readBalanceResponse(status, {})
      assert.equal(v.accepted, null, `${status} was judged rather than reported`)
      assert.match(String(v.error), /inconclusive/)
    }
  })

  test('a success with no usable number does not invent one', () => {
    const v = readBalanceResponse(200, { status: 'success', data: {} })
    assert.equal(v.accepted, true)
    assert.equal(v.credits, null, 'an unreadable balance must not become a number')
  })

  test('the verdict never carries the key', () => {
    const v = readBalanceResponse(401, { message: 'Invalid key', key: 'should-not-be-echoed' })
    assert.ok(!JSON.stringify(v).includes('should-not-be-echoed'))
  })
})

describe('the SMS account state is visible to whoever has to fix it', () => {
  test('the diagnostics endpoint checks the account, not just the queue', () => {
    const route = codeOf('app/api/sms/delivery/route.ts')
    assert.match(route, /smsAccount\(\)/)
    assert.match(route, /account,/, 'the answer has to reach the screen')
  })

  test('and the screen says so plainly when nothing can be sent', () => {
    const page = codeOf('app/(portal)/admin/sms-delivery/page.tsx')
    assert.match(page, /No text message can be sent right now/)
    assert.match(page, /could not be checked/, 'an inconclusive check must read differently from a refusal')
    assert.match(page, /Credits left/)
  })

  test('the key itself is never sent to the browser', () => {
    /*
     * The endpoint reports an answer ABOUT the key, never the key. Three
     * lines are allowed to mention it — reading it, declaring it, and putting
     * it in the request header — and nothing else may, which is checked by
     * removing exactly those and looking for what is left.
     */
    const sms = codeOf('lib/integrations/sms.ts')
    const account = sms.slice(sms.indexOf('export async function smsAccount'))
    const remaining = account.split('\n').filter(line =>
      /\bapiKey\b/.test(line)
      && !/^\s*let apiKey: string$/.test(line)
      && !/^\s*apiKey = SECRETS\.arkeselApiKey$/.test(line)
      && !/^\s*headers: \{ 'api-key': apiKey \},$/.test(line)
    )
    assert.deepEqual(remaining, [], 'the key is used somewhere it should not be')
  })
})

describe('resetting a colleague’s PIN tells them', () => {
  const route = codeOf('app/api/admin/reset-pin/route.ts')

  test('the new PIN and the address are sent, not left with the administrator', () => {
    assert.match(route, /deliverPinReset\(target, newPin\)/)
    assert.match(route, /phone, email/, 'the destinations have to be read to be used')
  })

  test('and the administrator is told whether it actually arrived', () => {
    /*
     * The failure that matters. An administrator who believes the PIN was
     * sent and is wrong will not make the phone call they would otherwise
     * have made, so the response says which it was.
     */
    assert.match(route, /notified: notice\.sent/)
    assert.match(route, /you will need to pass it on yourself/)
  })

  test('the audit records that they were told, never what they were told', () => {
    assert.match(route, /notified: notice\.sent, notifiedVia: notice\.via/)
    const audit = route.slice(route.indexOf("action: 'staff.pin_reset'"))
    const metadata = audit.slice(audit.indexOf('metadata:'), audit.indexOf('})'))
    assert.ok(!/newPin|\bpin\b/.test(metadata), 'the PIN must not reach the audit record')
  })

  test('the PIN is never in the response either', () => {
    const response = route.slice(route.indexOf('return NextResponse.json({\n    success: true,'))
    assert.ok(!/newPin/.test(response), 'the PIN travels in the message and nowhere else')
  })

  test('the recovery PIN is not sent in the same message', () => {
    /*
     * It is shown to the administrator once instead. Two credentials in one
     * intercepted text hands over both the way in and the way back in.
     */
    const delivery = codeOf('lib/auth/otpDelivery.ts')
    const fn = delivery.slice(delivery.indexOf('export async function deliverPinReset'))
    assert.ok(!/recovery/i.test(fn))
    assert.match(route, /deliverPinReset\(target, newPin\)/)
    assert.ok(route.indexOf('deliverPinReset') > route.indexOf('setRecoveryPin'),
      'the notice is sent after the recovery PIN is issued, and carries only the sign-in PIN')
  })

  test('a reset the colleague was not told about is not shown as a success', () => {
    const page = codeOf('app/(portal)/admin/staff/page.tsx')
    assert.match(page, /if \(d\.notified\) toast\.success/)
    assert.match(page, /else toast\.error/)
  })

  test('and a phone number alone is enough to create them', () => {
    /*
     * Creating staff demanded an email "because staff receive their login
     * code by email". They do not any more, and the phone number — which is
     * the channel that works — was already required.
     */
    const page = codeOf('app/(portal)/admin/staff/page.tsx')
    assert.ok(!/Email is required/.test(page))
    assert.match(page, /Full name and phone number are required/)
  })
})

describe('a new member of staff is told the truth about signing in', () => {
  const route = codeOf('app/api/admin/create-staff/route.ts')
  const page = codeOf('app/(portal)/admin/staff/page.tsx')

  test('sign-in takes the PIN alone, and the message says so', () => {
    /*
     * The onboarding text read "Login with your phone (024…) and PIN". The
     * login screen has one field, and verify-pin's body schema has one
     * property: the PIN identifies the account, which is why two people
     * cannot share one. So this sent every new member of staff looking for a
     * field that does not exist.
     */
    assert.ok(!/with your phone|phone \+ PIN|phone number \+ PIN/i.test(route))
    assert.ok(!/phone \+ PIN|phone number \+ PIN/i.test(page))
    assert.match(route, /your PIN is all you need/)
  })

  test('and is given the portal address from one source', () => {
    assert.match(route, /const portalUrl = CONFIG\.appUrl/,
      'a second hardcoded address is the one that still names the old domain')
    assert.match(route, /Sign in at \$\{portalUrl\}/)
  })

  test('the administrator is shown what the server actually said', () => {
    // Rather than a second copy of the instructions, which can disagree.
    assert.match(page, /creds\.note/)
  })
})

/**
 * ─── A CODE IN A READABLE LOG IS NOT HISTORY ────────────────────────────────
 *
 * sms_logs stores the message body, and /admin/sms-delivery shows it to
 * anyone holding `broadcast` or `settings`. The comment beside that select
 * said "it never contains a credential", which was true when every text was a
 * class reminder.
 *
 * A sign-in code lasts six hours. One sitting in a diagnostics screen a
 * colleague can open is a working second factor, not a record of a past
 * event — and the onboarding message has carried an initial PIN all along.
 */
describe('a credential is never written into the delivery log', () => {
  const sms = codeOf('lib/integrations/sms.ts')
  const delivery = codeOf('lib/auth/otpDelivery.ts')
  const create = codeOf('app/api/admin/create-staff/route.ts')

  test('the body stored is the redacted one, not the message', () => {
    assert.match(sms, /const logged = log\.credential \? redactedBody\(log\.kind\) : message/)

    /*
     * Scoped to the sms_logs insert. The request to the provider has to
     * contain the real message — that is the message — so asserting on the
     * whole file would forbid sending anything at all.
     */
    const insert = sms.slice(sms.indexOf("from('sms_logs').insert("))
    const row = insert.slice(0, insert.indexOf('}))'))
    assert.match(row, /message: logged,/)
    assert.ok(!/^\s*message,$/m.test(row), 'the raw body is still being inserted')
  })

  test('every message that carries one says so', () => {
    for (const [what, code] of [['the sign-in code', delivery], ['onboarding', create]] as const) {
      assert.match(code, /credential: true/, `${what} does not mark its message`)
    }
    assert.match(delivery, /kind: 'auth_code', credential: true/)
    assert.match(delivery, /kind: 'pin_reset', credential: true/)
    assert.match(create, /kind: 'staff_onboarding', credential: true/)
  })

  test('and the recorder cannot report a credential as sent', () => {
    /*
     * With no API key, deliverSMS hands the message to a recording provider
     * that keeps it and answers ok, so a flow which follows a text still
     * runs. For a PIN that is a lie with consequences: the administrator is
     * told their colleague has it when nobody does, and the body is kept.
     */
    assert.match(sms, /if \(log\.credential\) \{/)
    assert.match(sms, /refusing to record a credential message as sent/)
    const branch = sms.slice(sms.indexOf('if (log.credential) {'))
    const ret = branch.slice(0, branch.indexOf('const result'))
    assert.match(ret, /ok: false, permanent: true/)
  })

  test('the screen no longer claims the log holds no credentials', () => {
    const route = codeOf('app/api/sms/delivery/route.ts')
    assert.ok(!/It never contains a\s+credential/.test(route))
  })

  test('what is stored still identifies the message', () => {
    // Useless diagnostics would just move the problem: the kind is kept, and
    // the label says what the body was.
    assert.match(sms, /kind: log\.kind \?\? null,/)
  })
})

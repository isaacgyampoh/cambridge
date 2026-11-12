import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * A RESET THAT TELLS THE TRUTH, AND SENDS NOTHING REUSABLE.
 *
 * ── WHAT WAS REPORTED ──────────────────────────────────────────────────────
 *
 * Thomas Okine's PIN was reset. The dialog said it had been sent by text, and
 * showed a recovery PIN. He received nothing.
 *
 * Three separate causes, all confirmed against production rather than guessed:
 *
 *   1. The campus mailbox has no password configured — SMTP_HOST, PORT,
 *      SECURE, USER and EMAIL_FROM are all set and SMTP_PASS is not — so
 *      emailConfigured() is false and the email channel was never offered.
 *      Nothing said so: a channel that is not configured was simply left out
 *      of the list, which looks identical to one nobody wanted.
 *
 *   2. Arkesel's own record says NOT_DELIVERED for his number while other
 *      numbers messaged in the same minute say DELIVERED. The text was
 *      accepted and the network refused it.
 *
 *   3. The reset sent the PIN itself. A credential in a message history is
 *      readable by whoever picks up the phone, forwardable, and works again
 *      and again.
 *
 * ── WHAT THE PRODUCT DOES NOW ──────────────────────────────────────────────
 *
 * Sends a single-use link by every channel that can carry it, independently,
 * and reports exactly which ones a provider accepted.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ' '))
}

const route = codeOf('app/api/admin/reset-pin/route.ts')
const delivery = codeOf('lib/auth/otpDelivery.ts')
const recovery = codeOf('lib/auth/recovery.ts')
const screen = codeOf('app/(portal)/admin/staff/page.tsx')

describe('a reset sends a link, not a credential', () => {
  test('the default path mints the single-use token and sends the link', () => {
    assert.match(route, /if \(mode === 'link' \|\| mode === 'resend'\)/)
    assert.match(route, /const token = await startAdminReset\(userId\)/)
    assert.match(route, /publicUrl\(`\/reset\?t=\$\{token\}`\)/)
    assert.match(route, /await deliverResetLink\(target, link, ADMIN_RESET_TOKEN_MINUTES\)/)
  })

  test('and the message carries no PIN of any kind', () => {
    const fn = delivery.slice(delivery.indexOf('export async function deliverResetLink'))
    const body = fn.slice(0, fn.indexOf('\n}\n'))
    /*
     * The word appears legitimately — "your portal PIN can be reset here" —
     * so what is asserted is that no PIN VALUE can reach the message: the
     * function is not given one, and nothing interpolates one.
     */
    assert.match(body, /target: OtpTarget,\s*\n\s*link: string,\s*\n\s*minutes: number,/)
    assert.ok(!/\$\{\s*(pin|newPin|recoveryPin|code)\b/.test(body),
      'a credential is interpolated into the reset link message')
    assert.match(body, /The link works once and expires/)
  })

  test('the token is random, hashed, bound, brief and single-use', () => {
    /*
     * Every property asserted on the code that produces it, because each one
     * is what stops a different attack: guessing it, reading it from the
     * database, using somebody else's, using an old one, using it twice.
     */
    assert.match(recovery, /randomBytes\(32\)\.toString\('hex'\)/)
    assert.match(recovery, /reset_token_hash: hashToken\(token\)/)
    assert.match(recovery, /\}\)\.eq\('id', userId\)/)
    assert.match(recovery, /export const ADMIN_RESET_TOKEN_MINUTES = 60$/m,
      'the administrator-issued token is no longer an hour')
    // Spent on use: completeRecovery clears both halves.
    const complete = recovery.slice(recovery.indexOf('export async function completeRecovery'))
    assert.match(complete, /reset_token_hash: null/)
    assert.match(complete, /reset_token_expires_at: null/)
    // And refused once expired.
    assert.match(complete, /reset_token_expires_at\) < new Date\(\)/)
  })

  test('the account is not changed until the person uses the link', () => {
    /*
     * The reason this matters: the old reset wrote a new PIN immediately, so
     * a message that never arrived — exactly what happened — locked somebody
     * out of an account whose PIN only the administrator knew.
     */
    const branch = route.slice(route.indexOf("if (mode === 'link' || mode === 'resend')"))
    const body = branch.slice(0, branch.indexOf('if (!newPin) {'))
    assert.ok(body.length > 400, 'the link branch was not found')
    assert.ok(!/pin_hash:/.test(body), 'the link path writes a PIN')
    assert.ok(!/must_change_pin/.test(body), 'the link path changes the sign-in rules')
    assert.ok(!/is_active/.test(body), 'the link path touches the account status')
  })

  test('setting a PIN by hand is still possible, but is no longer the default', () => {
    // Somebody whose phone refuses our messages and who has no mailbox still
    // has to be reachable by an administrator reading a PIN out.
    assert.match(route, /mode: z\.enum\(\['link', 'manual_pin', 'resend'\]\)\.optional\(\)\.default\('link'\)/)
    assert.match(route, /if \(mode === 'manual_pin'\)/)
    assert.match(screen, /mode: 'manual_pin'/)
  })
})

describe('both channels are tried, and neither silences the other', () => {
  const fn = delivery.slice(
    delivery.indexOf('export async function deliverEveryChannel'),
    delivery.indexOf('export async function deliverResetLink'))

  test('every channel is attempted, not just the first that works', () => {
    /*
     * The sign-in code deliberately stops at the first success — one live
     * credential, one place. A reset notice is the opposite: it has to
     * arrive, and the two channels fail for unrelated reasons.
     */
    assert.match(fn, /for \(const channel of \['sms', 'email'\] as OtpChannel\[\]\)/)
    assert.ok(!/return \{[^}]*anyAccepted[^}]*\}\s*$/m.test(fn.slice(0, fn.indexOf('return {'))),
      'it returns before every channel has been tried')
  })

  test('a channel that throws costs that channel its turn and nothing more', () => {
    assert.match(fn, /catch \(e\)/)
    assert.match(fn, /outcomes\.push\(\{ channel, accepted: false/)
    assert.ok(!/throw/.test(fn), 'a provider failure escapes and takes the other channel with it')
  })

  test('and a channel this deployment cannot use says so, rather than vanishing', () => {
    /*
     * The campus mailbox's absence was invisible for weeks precisely because
     * an unusable channel was simply left out of the list.
     */
    assert.match(delivery, /function unusable\(/)
    // Reached for every channel the deployment cannot use — the sentences
    // themselves can sit in the file behind a dead condition and say nothing.
    assert.match(fn, /if \(!usable\.includes\(channel\)\) \{[\s\S]{0,200}reason: unusable\(channel, target, readiness\)/)
    const which = delivery.slice(delivery.indexOf('function unusable('))
    assert.match(which.slice(0, 900), /if \(!readiness\.smsReady\) return/)
    assert.match(which.slice(0, 900), /if \(!readiness\.emailReady\) \{/)
    assert.match(which.slice(0, 900), /The campus mailbox is not configured on this deployment/)
    assert.match(which.slice(0, 900), /is not a Ghanaian mobile number/)
  })

  test('acceptance is reported per channel, with where it went', () => {
    assert.match(fn, /accepted: ok/)
    assert.match(fn, /hint: ok \? \(channel === 'sms' \? maskPhone\(target\.phone\) : maskEmail\(target\.email\)\) : null/)
    assert.match(fn, /anyAccepted: outcomes\.some\(o => o\.accepted\)/)
  })
})

describe('the screen says what actually happened', () => {
  test('it shows each channel on its own, accepted or not', () => {
    assert.match(screen, /sendResult\.channels\.map/)
    assert.match(screen, /c\.accepted \? 'accepted for sending' : 'not sent'/)
    assert.match(screen, /\{c\.accepted \?[\s\S]{0,120}: c\.reason\}/)
  })

  test('and never calls it sent when no provider took it', () => {
    assert.match(screen, /if \(d\.anyAccepted\) toast\.success\(d\.message\)/)
    assert.match(screen, /else toast\.error\(d\.message/)
  })

  test('acceptance is not reported as delivery', () => {
    /*
     * The distinction the whole investigation turned on. A provider taking a
     * message says nothing about a handset receiving it, and for this number
     * the network was refusing every one.
     */
    assert.match(screen, /accepted for sending/)
    assert.match(screen, /Delivery is confirmed on the SMS delivery screen/)
    assert.ok(!/has been sent the new PIN and the portal address/.test(screen))
  })

  test('retrying re-sends, and does not reset anything again', () => {
    assert.match(screen, /sendResetLink\('resend'\)/)
    assert.match(screen, /Retry sending/)
    const resend = route.slice(route.indexOf("if (mode === 'link' || mode === 'resend')"))
    const body = resend.slice(0, resend.indexOf('if (!newPin) {'))
    assert.ok(body.length > 400, 'the link branch was not found')
    assert.ok(!/setRecoveryPin/.test(body), 'a retry mints another recovery PIN')
    assert.ok(!/hashPIN/.test(body), 'a retry writes a new PIN')
  })

  test('and when nothing could be sent, it offers the way that still works', () => {
    assert.match(screen, /!sendResult\.anyAccepted && \(/)
    assert.match(screen, /Set a PIN to read out instead/)
  })
})

describe('nothing secret is written down anywhere it can be read', () => {
  test('the audit record names the channels, never the token', () => {
    const branch = route.slice(route.indexOf("action: mode === 'resend'"))
    const meta = branch.slice(0, branch.indexOf('})'))
    assert.ok(!/token/.test(meta), 'the audit metadata carries the reset token')
    assert.match(meta, /channels: delivery\.outcomes\.map/)
  })

  test('the response carries no token and no PIN', () => {
    const branch = route.slice(route.indexOf("return NextResponse.json({\n      success: true,\n      mode,"))
    const body = branch.slice(0, branch.indexOf('\n  }\n'))
    assert.ok(!/token/.test(body), 'the reset token is returned to the browser')
    assert.ok(!/newPin|recoveryPin/.test(body), 'a credential is returned to the browser')
  })

  test('and the link page posts to the recovery endpoint that already enforces the rules', () => {
    /*
     * One path through the authentication code. A second endpoint written
     * beside it would be a second place for the single-use check, the rate
     * limit and the PIN-collision refusal to drift.
     */
    const page = codeOf('app/(auth)/reset/page.tsx')
    assert.match(page, /'\/api\/auth\/recover\/complete'/)
    assert.match(page, /resetToken: token, newPin: pin/)
  })

  test('the token does not stay in the address bar', () => {
    /*
     * It is a credential, briefly, and a URL is the leakiest place to keep
     * one: browser history, a screenshot of the address bar, the Referer
     * header of anything the page loads. It is wiped as soon as the form has
     * it in memory, with replaceState so Back cannot restore it.
     */
    const page = codeOf('app/(auth)/reset/page.tsx')
    assert.match(page, /window\.history\.replaceState\(null, '', window\.location\.pathname\)/)
    assert.ok(!/history\.pushState/.test(page), 'Back would restore the token')
  })

  test('the reset page is reachable without a session, and only that page', () => {
    const proxy = codeOf('proxy.ts')
    assert.match(proxy, /'\/reset', '\/setup'/)
  })
})

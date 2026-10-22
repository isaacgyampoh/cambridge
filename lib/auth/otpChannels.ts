/*
 * Relative imports with extensions, deliberately. This module is unit tested
 * directly by the node test runner, which does not resolve the '@/' alias —
 * and the decision it makes is exactly the one worth executing in a test
 * rather than grepping for, because getting it wrong locks people out of the
 * portal silently.
 */
import { canonicalGhanaMobile } from '../phone.ts'
import { otpValidityPhrase } from './otpPolicy.ts'
import { BRAND } from '../brand.ts'

/**
 * WHICH WAY A SIGN-IN CODE CAN TRAVEL, AND IN WHAT ORDER.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Every code the portal issues — at sign-in, on resend, and in PIN recovery —
 * went by email and only by email. One channel; and when that channel is not
 * configured, nobody who is not OTP-exempt can sign in at all. They enter the
 * right PIN and then wait on a code screen for a message that was never sent.
 *
 * That was not hypothetical. Every active member of staff has both a phone
 * number and an email address on file, the SMS account is funded and working,
 * and the campus mailbox has no password set — so the only channel in the
 * code was the only one that could not deliver.
 *
 * ── THE ORDER ──────────────────────────────────────────────────────────────
 *
 * SMS first. The code is read off a phone that is already in the person's
 * hand, it arrives in seconds, and it does not land in a spam folder. Email
 * is the fallback, and OTP_CHANNEL=email swaps the two without a deploy for
 * whoever is paying the SMS bill. Each text costs a credit, which is worth
 * knowing before enabling it for several hundred sign-ins a day.
 */

export type OtpChannel = 'sms' | 'email'

export type OtpTarget = {
  phone?: string | null
  email?: string | null
  full_name?: string | null
}

/** Whether each channel's SENDER is configured on this deployment. */
export type ChannelReadiness = {
  smsReady: boolean
  emailReady: boolean
  prefer?: OtpChannel
}

/** A destination this account can actually be reached at. */
export function hasPhone(target: OtpTarget): boolean {
  return Boolean(canonicalGhanaMobile(target.phone))
}

export function hasEmail(target: OtpTarget): boolean {
  return String(target.email ?? '').includes('@')
}

/**
 * The channels this person can be reached on, in the order to try them.
 *
 * Two conditions, both required. A channel with no destination on the account
 * is not a channel; and one whose sender the deployment has not configured is
 * not one either — offering it would strand somebody on a code screen in
 * exactly the way the email-only path did. An empty list is the honest answer
 * and the caller must refuse rather than sign them in.
 */
export function channelsFor(target: OtpTarget, opts: ChannelReadiness): OtpChannel[] {
  const out: OtpChannel[] = []
  if (hasPhone(target) && opts.smsReady) out.push('sms')
  if (hasEmail(target) && opts.emailReady) out.push('email')

  // The preference reorders what is possible; it never adds a channel that
  // cannot deliver, so OTP_CHANNEL=email on a deployment with no mailbox
  // still sends by SMS rather than sending nothing.
  if (opts.prefer === 'email' && out.length === 2) return ['email', 'sms']
  return out
}

/**
 * The text of the code message. Short: it is read off a lock screen.
 *
 * No link, and nothing that reads like a prompt to act. A code message that
 * asks the reader to do anything teaches them to obey code messages, which is
 * the entire mechanism of the attack this code exists to stop.
 */
export function otpSmsText(code: string, name?: string | null): string {
  const first = String(name ?? '').trim().split(' ')[0]
  return `${first ? first + ', y' : 'Y'}our ${BRAND.name} sign-in code is ${code}. `
    + `It lasts ${otpValidityPhrase()}. Do not share it with anyone.`
}

/**
 * "Ama, your Cambridge portal PIN has been reset to 4821. Sign in at
 *  https://portal.cambridge.edu.gh and choose your own PIN. Do not share it."
 *
 * ── WHY THE ADDRESS IS IN IT ───────────────────────────────────────────────
 *
 * A reset used to be a PIN read out across a desk: the administrator typed a
 * new one and told the person what it was, or did not, and the colleague
 * either knew where the portal lived or asked. Sending the PIN with the
 * address makes the message complete on its own — somebody who has never
 * signed in has everything they need in one text.
 *
 * ── AND WHY A LINK IS ALLOWED HERE ─────────────────────────────────────────
 *
 * otpSmsText deliberately carries no URL: a sign-in code that asks the reader
 * to tap something trains them to obey code messages, which is the attack.
 * This message is a different thing — it is the one that tells somebody their
 * credential changed and where to use it, and withholding the address does
 * not make the PIN in the same message any safer. It is the portal's own
 * address from lib/url.ts, which is a constant in production, so it cannot be
 * pointed somewhere else by configuration.
 */
export function pinResetSmsText(pin: string, name: string | null | undefined, portalUrl: string): string {
  const first = String(name ?? '').trim().split(' ')[0]
  return `${first ? first + ', y' : 'Y'}our portal PIN has been reset to ${pin}. `
    + `Sign in at ${portalUrl} and choose your own PIN. Do not share this with anyone.`
}

/**
 * What to say when nothing could be sent.
 *
 * Two different situations, and they need different sentences: an account
 * with no destination on file needs an administrator to add one, and no
 * amount of retrying will help. A send that failed is worth retrying.
 *
 * Neither names a missing secret or a provider. This text reaches an
 * unauthenticated screen, and which integrations a deployment is missing is
 * not something to publish there.
 */
export function undeliverableMessage(target: OtpTarget): string {
  if (!hasPhone(target) && !hasEmail(target)) {
    return 'This account has no phone number or email address on file, so a sign-in code cannot be sent. '
      + 'Ask an administrator to add one.'
  }
  return 'Your sign-in code could not be sent just now. Please try again shortly, or contact your administrator.'
}

import { canonicalGhanaMobile } from '@/lib/phone'
import { SECRETS } from '@/lib/config.server'
import { sendSMS } from '@/lib/integrations/sms'
import { sendOTPEmail, sendEmail, emailConfigured } from '@/lib/integrations/email'
import { CONFIG } from '@/lib/config'
import { BRAND } from '@/lib/brand'
import { maskEmail, maskPhone } from '@/lib/ui/contact'
import {
  channelsFor, deliveryObstacle, otpSmsText, pinResetSmsText, undeliverableMessage,
  type OtpChannel, type OtpTarget,
} from '@/lib/auth/otpChannels'

/**
 * Sending a sign-in code, by whichever channel can carry it.
 *
 * The decision about WHICH channel, and the wording, live in otpChannels.ts
 * where they can be unit tested without a network. This file is the part that
 * touches the outside world.
 */

export { channelsFor, deliveryObstacle, otpSmsText, pinResetSmsText, undeliverableMessage }
export type { OtpChannel, OtpTarget }

export type OtpDelivery = {
  sent: boolean
  via: OtpChannel | null
  /** What to tell the person, with the destination partly hidden. */
  hint: string | null
  /** Channels that were tried and did not deliver, for the log. */
  failed: OtpChannel[]
  /**
   * Why nothing arrived, for the person who has to do something about it.
   *
   * Null when it was sent. "Could not be sent" on its own is what leaves a
   * colleague locked out while everybody assumes a text is on its way.
   */
  reason: string | null
}

/** Which senders this deployment has configured. */
export function channelReadiness() {
  return {
    smsReady: Boolean(SECRETS.arkeselApiKey),
    emailReady: emailConfigured(),
    prefer: (SECRETS.otpChannel === 'email' ? 'email' : 'sms') as OtpChannel,
  }
}

/**
 * Try each usable channel in turn, and say truthfully whether one carried it.
 *
 * ── ONE LOOP, ONE PLACE THAT CAN CLAIM SUCCESS ─────────────────────────────
 *
 * Both messages the portal sends to a person's own phone or mailbox — the
 * sign-in code and a PIN reset — go through here, because the loop is the
 * part with the invariant in it: sent:true is returned ONLY in the branch of
 * a send that returned true.
 *
 * sent:true because a channel was ATTEMPTED is the stranded code screen in
 * its original form: the caller shows a code entry box, and the person waits
 * at it for a message no provider ever accepted. Written twice, that is a
 * property that holds in one copy and quietly lapses in the other.
 *
 * A sender that throws costs that channel its turn and nothing more. An HTTP
 * client that throws on a timeout is the normal case, and letting it escape
 * would take the fallback down with it.
 */
async function deliverByChannel(
  target: OtpTarget,
  label: string,
  send: Record<OtpChannel, () => Promise<boolean>>,
): Promise<OtpDelivery> {
  const readiness = channelReadiness()
  const order = channelsFor(target, readiness)
  const failed: OtpChannel[] = []

  for (const channel of order) {
    try {
      if (await send[channel]()) {
        return {
          sent: true,
          via: channel,
          hint: channel === 'sms' ? maskPhone(target.phone) : maskEmail(target.email),
          failed,
          reason: null,
        }
      }
    } catch (e) {
      console.error(`[${label}] sending by`, channel, 'threw:', e instanceof Error ? e.message : e)
    }
    failed.push(channel)
  }

  return {
    sent: false, via: null, hint: null, failed,
    /*
     * An obstacle means there was no usable channel to begin with — a number
     * that is not a mobile, a sender that is not configured — and no amount
     * of retrying changes it. Otherwise a channel was tried and the provider
     * did not take it, which is a different conversation.
     */
    reason: deliveryObstacle(target, readiness)
      || `the message was rejected by ${failed.join(' and ') || 'the provider'}`,
  }
}

/**
 * Send a sign-in code.
 *
 * channelsFor only offers a channel whose destination parses, which is what
 * makes the assertions below safe: sms is never tried for a number
 * canonicalGhanaMobile rejects.
 */
export async function deliverOTP(target: OtpTarget, code: string): Promise<OtpDelivery> {
  return deliverByChannel(target, 'otp', {
    sms: () => sendSMS(
      canonicalGhanaMobile(target.phone) as string,
      otpSmsText(code, target.full_name),
      // The body is not written to sms_logs: a code lasts six hours, so one
      // sitting in a readable log is a working second factor, not history.
      { kind: 'auth_code', credential: true },
    ),
    email: () => sendOTPEmail(String(target.email), target.full_name || '', code),
  })
}

/**
 * ── EVERY CHANNEL, INDEPENDENTLY ───────────────────────────────────────────
 *
 * deliverByChannel above stops at the first success, which is right for a
 * sign-in code: one code, one place, the fewest copies of a live credential.
 *
 * It is wrong for telling somebody their account has been reset. That message
 * has to ARRIVE, and the two channels fail in unrelated ways — a handset that
 * is off or refusing messages from this sender, a mailbox nobody has
 * configured. Stopping at the first success means the second channel is never
 * tried; stopping at the first FAILURE, which an earlier version of this did
 * by returning early, means one dead channel silences the other.
 *
 * So: try all of them, report each one on its own, and let the caller say
 * what actually happened. "Email failed, SMS accepted" is a true sentence an
 * administrator can act on. "Could not be sent" was not.
 */
export type ChannelOutcome = {
  channel: OtpChannel
  /** The provider accepted it. NOT a promise that a handset received it. */
  accepted: boolean
  /** Where it went, partly hidden, when it was accepted. */
  hint: string | null
  /** Why not, in words an administrator can act on. */
  reason: string | null
}

export type MultiDelivery = {
  /** True when at least one provider took the message. */
  anyAccepted: boolean
  outcomes: ChannelOutcome[]
}

/**
 * Why a channel this deployment cannot use is still reported.
 *
 * Silence is what made the campus mailbox's absence invisible for weeks:
 * channelsFor simply left email out of the list, so nothing anywhere said
 * "there is no mailbox configured" — it looked exactly like a deployment that
 * had decided not to use email.
 */
function unusable(channel: OtpChannel, target: OtpTarget, readiness: ReturnType<typeof channelReadiness>): string {
  if (channel === 'sms') {
    if (!readiness.smsReady) return 'Text messages are not configured on this deployment.'
    return `The number on their record (${String(target.phone ?? '').trim() || 'none'}) is not a Ghanaian mobile number.`
  }
  if (!readiness.emailReady) {
    return 'The campus mailbox is not configured on this deployment, so no email can be sent.'
  }
  return String(target.email ?? '').trim()
    ? `The address on their record (${String(target.email).trim()}) is not a usable email address.`
    : 'Their record has no email address.'
}

export async function deliverEveryChannel(
  target: OtpTarget,
  label: string,
  send: Record<OtpChannel, () => Promise<boolean>>,
): Promise<MultiDelivery> {
  const readiness = channelReadiness()
  const usable = channelsFor(target, readiness)
  const outcomes: ChannelOutcome[] = []

  for (const channel of ['sms', 'email'] as OtpChannel[]) {
    if (!usable.includes(channel)) {
      outcomes.push({ channel, accepted: false, hint: null, reason: unusable(channel, target, readiness) })
      continue
    }

    try {
      const ok = await send[channel]()
      outcomes.push({
        channel,
        accepted: ok,
        hint: ok ? (channel === 'sms' ? maskPhone(target.phone) : maskEmail(target.email)) : null,
        // A sender that answers false has refused it; it did not throw, and
        // there is nothing more specific to report than that.
        reason: ok ? null : 'The provider did not accept it.',
      })
    } catch (e) {
      /*
       * One channel's failure must not take the other down with it. An HTTP
       * client that throws on a timeout is the ordinary case, and before this
       * loop existed it ended the whole delivery.
       */
      const detail = e instanceof Error ? e.message : String(e)
      console.error(`[${label}] sending by`, channel, 'threw:', detail)
      outcomes.push({ channel, accepted: false, hint: null, reason: `The provider failed: ${detail}` })
    }
  }

  return { anyAccepted: outcomes.some(o => o.accepted), outcomes }
}

/**
 * Tell somebody their PIN can be reset, and give them the one-time link.
 *
 * No PIN, no recovery PIN, no code that works twice — the link is spent the
 * moment it sets a new PIN, so a message sitting in an inbox or a phone is
 * worth nothing to whoever finds it later.
 */
export async function deliverResetLink(
  target: OtpTarget,
  link: string,
  minutes: number,
): Promise<MultiDelivery> {
  const first = String(target.full_name ?? '').trim().split(' ')[0]
  const text = `${first ? first + ', y' : 'Y'}our ${BRAND.name} portal PIN can be reset here: ${link} `
    + `The link works once and expires in ${minutes} minutes. If you did not expect this, tell your administrator.`

  return deliverEveryChannel(target, 'pin-reset-link', {
    sms: () => sendSMS(canonicalGhanaMobile(target.phone) as string, text, { kind: 'pin_reset_link' }),
    email: () => sendEmail(
      String(target.email),
      'Set a new PIN for the Cambridge portal',
      `<p>${first || 'Hello'},</p>`
      + '<p>Your PIN for the staff portal has been reset by an administrator. '
      + `Use this link to choose a new one: <a href="${link}">${link}</a></p>`
      + `<p>It works once and expires in ${minutes} minutes.</p>`
      + '<p>If you did not expect this, tell your administrator — do not use the link.</p>',
      text,
    ),
  })
}

/**
 * Tell somebody their PIN was reset, and where to use it.
 *
 * ── WHY THE RESULT IS RETURNED RATHER THAN IGNORED ─────────────────────────
 *
 * Before this, a reset sent nothing: the administrator set a PIN and the
 * colleague found out when somebody remembered to tell them. Sending it is
 * the improvement — but an administrator who BELIEVES it was sent and is
 * wrong is worse off than one who knows they have to make a phone call,
 * because they will not make it. So the caller is told whether it arrived,
 * and the screen says to pass it on when it did not.
 *
 * The PIN is in the message and nowhere else: not in the audit record, not in
 * a log line, not in the HTTP response.
 */
export async function deliverPinReset(target: OtpTarget, pin: string): Promise<OtpDelivery> {
  const url = CONFIG.appUrl
  const first = String(target.full_name ?? '').trim().split(' ')[0]

  return deliverByChannel(target, 'pin-reset', {
    sms: () => sendSMS(
      canonicalGhanaMobile(target.phone) as string,
      pinResetSmsText(pin, target.full_name, url),
      { kind: 'pin_reset', credential: true },
    ),
    email: () => sendEmail(
      String(target.email),
      'Your portal PIN has been reset',
      `<p>${first || 'Hello'},</p>`
      + `<p>Your PIN for the staff portal has been reset to <strong style="font-size:20px;letter-spacing:2px">${pin}</strong>.</p>`
      + `<p>Sign in at <a href="${url}">${url}</a> and you will be asked to choose your own PIN.</p>`
      + '<p>If you did not expect this, contact your administrator — do not share this PIN with anyone.</p>',
      pinResetSmsText(pin, target.full_name, url)
      + ' If you did not expect this, contact your administrator.',
    ),
  })
}

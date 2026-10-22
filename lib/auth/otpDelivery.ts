import { canonicalGhanaMobile } from '@/lib/phone'
import { SECRETS } from '@/lib/config.server'
import { sendSMS } from '@/lib/integrations/sms'
import { sendOTPEmail, sendEmail, emailConfigured } from '@/lib/integrations/email'
import { CONFIG } from '@/lib/config'
import { maskEmail, maskPhone } from '@/lib/ui/contact'
import {
  channelsFor, otpSmsText, pinResetSmsText, undeliverableMessage,
  type OtpChannel, type OtpTarget,
} from '@/lib/auth/otpChannels'

/**
 * Sending a sign-in code, by whichever channel can carry it.
 *
 * The decision about WHICH channel, and the wording, live in otpChannels.ts
 * where they can be unit tested without a network. This file is the part that
 * touches the outside world.
 */

export { channelsFor, otpSmsText, pinResetSmsText, undeliverableMessage }
export type { OtpChannel, OtpTarget }

export type OtpDelivery = {
  sent: boolean
  via: OtpChannel | null
  /** What to tell the person, with the destination partly hidden. */
  hint: string | null
  /** Channels that were tried and did not deliver, for the log. */
  failed: OtpChannel[]
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
  const order = channelsFor(target, channelReadiness())
  const failed: OtpChannel[] = []

  for (const channel of order) {
    try {
      if (await send[channel]()) {
        return {
          sent: true,
          via: channel,
          hint: channel === 'sms' ? maskPhone(target.phone) : maskEmail(target.email),
          failed,
        }
      }
    } catch (e) {
      console.error(`[${label}] sending by`, channel, 'threw:', e instanceof Error ? e.message : e)
    }
    failed.push(channel)
  }

  return { sent: false, via: null, hint: null, failed }
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

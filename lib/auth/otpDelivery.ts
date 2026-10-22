import { canonicalGhanaMobile } from '@/lib/phone'
import { SECRETS } from '@/lib/config.server'
import { sendSMS } from '@/lib/integrations/sms'
import { sendOTPEmail, emailConfigured } from '@/lib/integrations/email'
import { maskEmail, maskPhone } from '@/lib/ui/contact'
import {
  channelsFor, otpSmsText, undeliverableMessage,
  type OtpChannel, type OtpTarget,
} from '@/lib/auth/otpChannels'

/**
 * Sending a sign-in code, by whichever channel can carry it.
 *
 * The decision about WHICH channel, and the wording, live in otpChannels.ts
 * where they can be unit tested without a network. This file is the part that
 * touches the outside world.
 */

export { channelsFor, otpSmsText, undeliverableMessage }
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
 * Send the code, and say truthfully whether it went anywhere.
 *
 * Never reports sent:true because a channel was ATTEMPTED. A code that did
 * not arrive must not look like one that did — a caller that believes a code
 * was sent shows a code screen, and the person waits at it indefinitely.
 * That is the failure this whole path exists to remove, so it must not be
 * reintroduced one layer up.
 */
export async function deliverOTP(target: OtpTarget, code: string): Promise<OtpDelivery> {
  const order = channelsFor(target, channelReadiness())
  const failed: OtpChannel[] = []

  for (const channel of order) {
    try {
      if (channel === 'sms') {
        // channelsFor only offers sms for a number that parses.
        const to = canonicalGhanaMobile(target.phone) as string
        if (await sendSMS(to, otpSmsText(code, target.full_name))) {
          return { sent: true, via: 'sms', hint: maskPhone(target.phone), failed }
        }
      } else if (await sendOTPEmail(String(target.email), target.full_name || '', code)) {
        return { sent: true, via: 'email', hint: maskEmail(target.email), failed }
      }
    } catch (e) {
      // A thrown sender is a failed channel, not a failed sign-in: the next
      // channel still gets its turn.
      console.error('[otp] sending by', channel, 'threw:', e instanceof Error ? e.message : e)
    }
    failed.push(channel)
  }

  return { sent: false, via: null, hint: null, failed }
}

import 'server-only'
import { emailAdmissionLetter, emailConfigured } from '@/lib/integrations/email'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { whatsappConnected, smsConnected } from '@/lib/messaging'
import { maskEmail, maskPhone } from '@/lib/ui/contact'
import {
  letterChannels, letterNoticeText, hasEmailAddress, hasPhoneNumber,
  type LetterChannel,
} from '@/lib/admissions/letterPolicy'

/**
 * Sending an admission letter, by whichever channel can carry it.
 *
 * The decision about which — and the wording — live in letterPolicy.ts where
 * they are unit tested. This is the part that touches the outside world.
 */

export type LetterDelivery = {
  sent: boolean
  via: LetterChannel | null
  /** Where it went, with the destination partly hidden, for the screen. */
  hint: string | null
  /** Channels tried that did not carry it. */
  failed: LetterChannel[]
}

export type LetterRecipient = {
  studentName: string | null
  email: string | null
  phone: string | null
  programme: string | null
  admissionNumber: string | null
  modeLabel: string | null
  fee: string | null
  registrationFee: string | null
  startDate: string | null
  letterDate: string
}

/**
 * Which senders this deployment has configured.
 *
 * `whatsappConnected()` and `smsConnected()` are asked rather than trusting
 * the senders' own return values, and that is not belt-and-braces: with no
 * API key both hand the message to a recording provider which keeps it and
 * answers true. For a lead notification that is deliberate — the flow after
 * it still runs. For a letter it would mark the admission as sent, write the
 * send into the audit trail, and tell the officer it had gone, while the
 * student had received nothing.
 */
export function letterSenders() {
  return {
    emailReady: emailConfigured(),
    whatsappReady: whatsappConnected(),
    smsReady: smsConnected(),
  }
}

/**
 * Send it, and say truthfully whether it went anywhere.
 *
 * sent:true only in the branch of a send that returned true. A letter
 * reported as sent is marked as sent on the admission, so a cheerful guess
 * here is a student who never gets their letter and an officer with no reason
 * to look.
 */
export async function deliverLetter(
  to: LetterRecipient,
  pdfUrl: string,
): Promise<LetterDelivery> {
  const order = letterChannels(
    { hasEmail: hasEmailAddress(to.email), hasPhone: hasPhoneNumber(to.phone) },
    letterSenders(),
  )
  const failed: LetterChannel[] = []
  const notice = letterNoticeText(to.studentName, to.programme, to.admissionNumber, pdfUrl)

  /*
   * One sender per channel, and one place that can report a success.
   *
   * Written as three branches, each with its own `return { sent: true }`,
   * this file had three chances to claim a send that had not happened. The
   * loop below has one, in the body of a send that returned true.
   */
  const send: Record<LetterChannel, () => Promise<boolean>> = {
    email: () => emailAdmissionLetter({
      to: String(to.email),
      name: to.studentName || 'Student',
      course: to.programme || '',
      admissionNo: to.admissionNumber || '',
      letterDate: to.letterDate,
      mode: to.modeLabel || '',
      fee: to.fee || '',
      registrationFee: to.registrationFee,
      startDate: to.startDate,
      pdfUrl,
    }),
    whatsapp: () => sendWhatsAppText(String(to.phone), notice),
    sms: () => sendSMS(String(to.phone), notice, { kind: 'admission_letter' }),
  }

  for (const channel of order) {
    try {
      if (await send[channel]()) {
        return {
          sent: true,
          via: channel,
          hint: channel === 'email' ? maskEmail(to.email) : maskPhone(to.phone),
          failed,
        }
      }
    } catch (e) {
      // A provider that throws costs that channel its turn, not the letter.
      console.error('[admission letter] sending by', channel, 'threw:',
        e instanceof Error ? e.message : e)
    }
    failed.push(channel)
  }

  return { sent: false, via: null, hint: null, failed }
}

/** What to tell the officer when nothing could carry it. */
export function undeliverableLetterMessage(to: { email: string | null; phone: string | null }): string {
  const senders = letterSenders()
  if (!senders.emailReady && !senders.whatsappReady && !senders.smsReady) {
    return 'The letter was generated, but no email, WhatsApp or SMS sender is configured on this deployment, '
      + 'so it could not be sent. Nothing has been marked as sent.'
  }
  if (!hasEmailAddress(to.email) && !hasPhoneNumber(to.phone)) {
    return 'The letter was generated, but this student has no email address and no phone number on file.'
  }
  return 'The letter was generated, but no channel accepted it. Nothing has been marked as sent. Please try again.'
}

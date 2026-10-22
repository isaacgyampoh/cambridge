import 'server-only'
import { CONFIG } from '@/lib/config'
import { BRAND, BRAND_VOICE } from '@/lib/brand'
import { SECRETS } from '@/lib/config.server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  type SmsProvider, type SendOutcome, classifyFailure, extractMessageId,
} from '@/lib/notifications/provider'
import { recordingProviderFor } from '@/lib/messaging'

/**
 * Arkesel SMS transport.
 *
 * This module is now only the transport: it makes one attempt and reports what
 * happened. Queueing, retries, idempotency and the delivery record live in
 * lib/notifications/sms.ts — which is what callers should use for anything
 * that matters.
 *
 * The API key previously sat in this file as a hardcoded fallback constant.
 * It has been removed: the key comes from the environment, and if it is
 * missing the attempt fails loudly rather than silently using a credential
 * that has been published.
 */

const ARKESEL_URL = 'https://sms.arkesel.com/api/v2/sms/send'
const TIMEOUT_MS = 15_000
const ARKESEL_BALANCE_URL = 'https://sms.arkesel.com/api/v2/clients/balance-details'

/*
 * Moved to ./smsRecipient so the rule can be exercised on its own — this
 * module reaches for server-only configuration and cannot be imported by a
 * test. Re-exported so every existing caller is unchanged.
 */
import { normaliseRecipient } from './smsRecipient'
export { normaliseRecipient }
import { readBalanceResponse } from './smsAccountCheck'

/** Kept as an alias so existing callers do not change. */
export type DeliveryResult = SendOutcome

/**
 * What a message is, for the delivery log.
 *
 * ── WHY `credential` EXISTS ────────────────────────────────────────────────
 *
 * sms_logs stores the message body, and the delivery screen shows it to
 * anyone holding the `broadcast` or `settings` portal. That was written when
 * every text was a class reminder or a voucher request, and the comment
 * beside it said so: "it never contains a credential".
 *
 * It does now. A sign-in code goes by SMS, a PIN reset goes by SMS, and an
 * onboarding message has carried an initial PIN all along. A live sign-in
 * code sitting in a readable log is not a leak of history — codes last six
 * hours, so it is a working second factor that a colleague can read off a
 * diagnostics screen.
 *
 * So a message marked `credential` is logged as a label. Status, provider,
 * timing and the error are all kept, which is what the screen is for; the
 * body is not, because nobody diagnosing a delivery needs the digits.
 */
export type SmsLogOptions = {
  /** Groups messages on the delivery screen, e.g. 'auth_code'. */
  kind?: string
  /** The body carries a one-time credential and must not be stored. */
  credential?: boolean
}

/** What is stored in place of a credential-bearing body. */
export function redactedBody(kind?: string): string {
  return `[not stored: ${kind ? kind.replace(/_/g, ' ') : 'this message'} carried a one-time credential]`
}

/**
 * One delivery attempt to one recipient.
 *
 * Distinguishing a permanent failure from a transient one is what stops the
 * queue burning four attempts on a phone number that will never be valid,
 * while still retrying a provider timeout that would have succeeded.
 */
export const arkeselProvider: SmsProvider = {
  name: 'arkesel',
  send: (to, message) => deliverSMS(to, message),
}

export async function deliverSMS(
  to: string,
  message: string,
  log: SmsLogOptions = {},
): Promise<DeliveryResult> {
  const recipient = normaliseRecipient(to)
  if (!recipient) {
    return { ok: false, permanent: true, error: `Not a valid Ghanaian mobile number: ${to}` }
  }
  if (!message?.trim()) {
    return { ok: false, permanent: true, error: 'Empty message' }
  }

  /*
   * ── NO SMS CREDENTIALS: RECORD, DO NOT FAIL ──────────────────────────────
   *
   * Text messages are deliberately disconnected. Failing every send would
   * make every flow that follows one unreachable — the assignment
   * notification, the voucher request, the class reminder — so none of them
   * could be exercised at all.
   *
   * The recording provider takes it instead: the message is kept, the send
   * reports success so the logic continues, and the sms_logs row the caller
   * writes says `recorded`. Assistant readiness reports the channel as
   * deferred rather than broken. Setting ARKESEL_API_KEY skips this entirely.
   */
  const recorder = recordingProviderFor('sms')
  if (recorder) {
    /*
     * A credential is the one thing that must NOT be recorded-and-reported.
     *
     * Recording exists so a flow that follows a text — an assignment
     * notification, a voucher request — still runs when SMS is disconnected.
     * A PIN is different: the whole point of the message is that the person
     * receives it. Answering "sent" means an administrator is told their
     * colleague has the PIN when nobody does, and the body would sit in the
     * recorder besides.
     */
    if (log.credential) {
      console.error('[sms] refusing to record a credential message as sent — SMS is not configured.')
      return {
        ok: false, permanent: true,
        error: 'SMS is not configured, so a one-time credential could not be delivered.',
      }
    }
    const result = await recorder.send({ to: recipient, body: message, kind: 'text' })
    // Not permanent: a recorded message is not a rejected one, and nothing
    // about it should make the queue give up on the number.
    return { ok: result.ok, permanent: false, response: { provider: recorder.id, recorded: true } }
  }

  let apiKey: string
  try {
    apiKey = SECRETS.arkeselApiKey
  } catch (e) {
    // ARKESEL_API_KEY is not set. Permanent until someone configures it, so
    // there is no point retrying — but it is logged loudly.
    console.error('[sms] ARKESEL_API_KEY is not configured — no SMS can be sent.')
    return { ok: false, permanent: true, error: (e as Error).message }
  }

  try {
    const res = await fetch(ARKESEL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        /*
         * The registered sender id. Provider approval is required for it, and
         * an unregistered one is dropped by the networks silently — so this
         * can be corrected through ARKESEL_SENDER_ID without a deploy, and
         * falls back to the value in lib/brand.ts when unset.
         */
        sender: SECRETS.arkeselSenderId || BRAND.smsSender,
        message,
        recipients: [recipient],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    const body = await res.json().catch(() => ({}))
    const ok = res.ok && (body?.status === 'success' || body?.code === 'ok')

    if (ok) {
      return {
        ok: true,
        permanent: false,
        // Persisted by the queue so "why didn't this arrive?" can be taken to
        // Arkesel with a reference rather than a description.
        providerMessageId: extractMessageId(body),
        response: body,
      }
    }

    return {
      ok: false,
      // Both signals, because Arkesel refuses some requests in the body.
      permanent: classifyFailure(res.status, body),
      error: `Arkesel ${res.status}: ${body?.message || body?.code || 'rejected'}`,
      response: body,
    }
  } catch (e) {
    // Timeout or network fault — worth another attempt later.
    return { ok: false, permanent: false, error: (e as Error).message }
  }
}

/**
 * Fire-and-forget send, kept for callers that have not yet moved to the queue.
 *
 * Prefer `queueSMS` from lib/notifications/sms.ts for anything a person is
 * relying on: this records the attempt but does not retry it.
 */
export async function sendSMS(
  to: string | string[],
  message: string,
  log: SmsLogOptions = {},
): Promise<boolean> {
  const recipients = (Array.isArray(to) ? to : [to])
    .map(normaliseRecipient)
    .filter((r): r is string => Boolean(r))

  if (!recipients.length) return false

  const results = await Promise.all(recipients.map(r => deliverSMS(r, message, log)))
  // What goes in the log. A credential-bearing body is described, not kept.
  const logged = log.credential ? redactedBody(log.kind) : message

  try {
    const sb = createServiceClient()
    await sb.from('sms_logs').insert(
      recipients.map((r, i) => ({
        recipient: r,
        message: logged,
        kind: log.kind ?? null,
        status: results[i].ok ? 'sent' : 'failed',
        provider: 'arkesel',
        provider_response: results[i].response ?? null,
        last_error: results[i].error || null,
        attempts: 1,
        sent_at: results[i].ok ? new Date().toISOString() : null,
      }))
    )
  } catch { /* never fail a send because the log write failed */ }

  return results.every(r => r.ok)
}

// ── SMS templates ────────────────────────────────────────────
export const SMS = {
  newLeadToPM: (leadName: string, source: string, count: number) =>
    `${BRAND_VOICE.smsPrefix} Alert: New lead "${leadName}" from ${source}. You have ${count} unassigned lead(s). Assign now: ${CONFIG.appUrl}/pm`,

  leadAssignedToMarketer: (marketerName: string, leadName: string) =>
    `${BRAND_VOICE.smsPrefix}: Hi ${marketerName}, a new lead "${leadName}" has been assigned to you. View now: ${CONFIG.appUrl}/marketer`,

  readyToJoinToOfficer: (officerName: string, studentName: string) =>
    `${BRAND_VOICE.smsPrefix}: Hi ${officerName}, ${studentName} is ready to join a class. Process admission: ${CONFIG.appUrl}/admission`,

  readyToJoinToAccountant: (studentName: string) =>
    `${BRAND_VOICE.smsPrefix}: ${studentName} is ready to join. Awaiting registration fee. Check: ${CONFIG.appUrl}/finance`,

  classReminder: (name: string, course: string, date: string, time: string, venue: string) =>
    `${BRAND_VOICE.smsPrefix} Reminder: Hi ${name}, your ${course} class is on ${date} at ${time}. Venue: ${venue}. See you there!`,

  applicationReceived: (name: string) =>
    `${BRAND_VOICE.smsPrefix}: Hi ${name}, we received your application. Our team will contact you shortly. Welcome to ${BRAND.shortName}!`,

  paymentConfirmed: (name: string, amount: string, receipt: string) =>
    `${BRAND_VOICE.smsPrefix}: Payment of GHS ${amount} confirmed. Receipt: ${receipt}. Thank you, ${name}!`,

  /**
   * Sent once payment is verified server-side and the registration is
   * confirmed. Names the programme and class mode from the applicant's own
   * record, so it can never describe the wrong one.
   */
  registrationConfirmed: (name: string, programme: string, classMode: string) =>
    `${BRAND_VOICE.smsPrefix}: Hi ${name}, your registration for ${programme} (${classMode}) is confirmed and your payment has been received. ` +
    `Admission processing has begun — watch this number and your email for the next step. Welcome to ${BRAND.shortName}!`,
}

/**
 * Is the SMS account actually usable, and how much is left in it?
 *
 * ── WHY "IS THE KEY SET" IS NOT THE QUESTION ───────────────────────────────
 *
 * The readiness screen reported SMS as configured because ARKESEL_API_KEY had
 * a value. It did — a stale one, which the provider answered with
 * {"message":"Invalid key"}. Present and working are different facts, and
 * only the second one sends anything.
 *
 * That now matters more than it did. A sign-in code goes by SMS first, so a
 * key that is set and rejected locks out every member of staff who is not
 * OTP-exempt, and reports itself as healthy while doing it.
 *
 * Credits are returned for the same reason: each sign-in code is one, so a
 * dwindling balance is a warning about the front door, not just about
 * marketing messages.
 *
 * ── INCONCLUSIVE IS NOT FAILED ─────────────────────────────────────────────
 *
 * `accepted` is null when the check itself could not be completed — a
 * timeout, a network error, a provider outage. Reporting that as "the key is
 * invalid" would send somebody rotating a credential that was fine, during
 * what is probably already an incident.
 *
 * The key is never returned, and never logged. Only the answer is.
 */
export type SmsAccount = {
  /** A key is present in the environment. */
  configured: boolean
  /** The provider recognised it. Null when the check could not be completed. */
  accepted: boolean | null
  /** Messages remaining, when the provider reports it. */
  credits: number | null
  /** The sender id messages will be sent as — registration is separate. */
  sender: string
  /** What went wrong, for the screen. Never includes the key. */
  error: string | null
}

export async function smsAccount(): Promise<SmsAccount> {
  const sender = SECRETS.arkeselSenderId || BRAND.smsSender

  let apiKey: string
  try {
    apiKey = SECRETS.arkeselApiKey
  } catch {
    return {
      configured: false, accepted: false, credits: null, sender,
      error: 'ARKESEL_API_KEY is not set, so no SMS can be sent — including sign-in codes.',
    }
  }

  try {
    const res = await fetch(ARKESEL_BALANCE_URL, {
      headers: { 'api-key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    const body = await res.json().catch(() => ({}))
    const verdict = readBalanceResponse(res.status, body)
    return { configured: true, sender, ...verdict }
  } catch (e) {
    // Inconclusive, not failed: the key was never judged.
    return {
      configured: true, accepted: null, credits: null, sender,
      error: `The SMS provider could not be reached (${e instanceof Error ? e.message : 'unknown error'}), so this is inconclusive.`,
    }
  }
}

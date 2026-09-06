import 'server-only'
import { CONFIG } from '@/lib/config'
import { SECRETS } from '@/lib/config.server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  type SmsProvider, type SendOutcome, classifyFailure, extractMessageId,
} from '@/lib/notifications/provider'

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

/** Normalise a Ghanaian number to the 233XXXXXXXXX form Arkesel expects. */
export function normaliseRecipient(num: string): string | null {
  const cleaned = String(num || '')
    .replace(/\s+/g, '')
    .replace(/^\+233/, '233')
    .replace(/^\+/, '')
    .replace(/^0/, '233')
  const digits = cleaned.replace(/[^0-9]/g, '')
  // A Ghanaian mobile number is 233 followed by nine digits.
  if (!/^233\d{9}$/.test(digits)) return null
  return digits
}

/** Kept as an alias so existing callers do not change. */
export type DeliveryResult = SendOutcome

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

export async function deliverSMS(to: string, message: string): Promise<DeliveryResult> {
  const recipient = normaliseRecipient(to)
  if (!recipient) {
    return { ok: false, permanent: true, error: `Not a valid Ghanaian mobile number: ${to}` }
  }
  if (!message?.trim()) {
    return { ok: false, permanent: true, error: 'Empty message' }
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
        sender: CONFIG.arkeselSenderId,
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
export async function sendSMS(to: string | string[], message: string): Promise<boolean> {
  const recipients = (Array.isArray(to) ? to : [to])
    .map(normaliseRecipient)
    .filter((r): r is string => Boolean(r))

  if (!recipients.length) return false

  const results = await Promise.all(recipients.map(r => deliverSMS(r, message)))

  try {
    const sb = createServiceClient()
    await sb.from('sms_logs').insert(
      recipients.map((r, i) => ({
        recipient: r,
        message,
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
    `CCE Alert: New lead "${leadName}" from ${source}. You have ${count} unassigned lead(s). Assign now: ${CONFIG.appUrl}/pm`,

  leadAssignedToMarketer: (marketerName: string, leadName: string) =>
    `CCE: Hi ${marketerName}, a new lead "${leadName}" has been assigned to you. View now: ${CONFIG.appUrl}/marketer`,

  readyToJoinToOfficer: (officerName: string, studentName: string) =>
    `CCE: Hi ${officerName}, ${studentName} is ready to join a class. Process admission: ${CONFIG.appUrl}/admission`,

  readyToJoinToAccountant: (studentName: string) =>
    `CCE: ${studentName} is ready to join. Awaiting registration fee. Check: ${CONFIG.appUrl}/finance`,

  classReminder: (name: string, course: string, date: string, time: string, venue: string) =>
    `CCE Reminder: Hi ${name}, your ${course} class is on ${date} at ${time}. Venue: ${venue}. See you there!`,

  applicationReceived: (name: string) =>
    `CCE: Hi ${name}, we received your application. Our team will contact you shortly. Welcome to Cambridge!`,

  paymentConfirmed: (name: string, amount: string, receipt: string) =>
    `CCE: Payment of GHS ${amount} confirmed. Receipt: ${receipt}. Thank you, ${name}!`,

  /**
   * Sent once payment is verified server-side and the registration is
   * confirmed. Names the programme and class mode from the applicant's own
   * record, so it can never describe the wrong one.
   */
  registrationConfirmed: (name: string, programme: string, classMode: string) =>
    `CCE: Hi ${name}, your registration for ${programme} (${classMode}) is confirmed and your payment has been received. ` +
    `Admission processing has begun — watch this number and your email for the next step. Welcome to Cambridge!`,
}

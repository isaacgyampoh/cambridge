import { canonicalGhanaMobile } from '@/lib/phone'
import { normaliseWasenderKey, classifyWasender, type FailureKind } from '@/lib/whatsapp/wasenderRules'
import { SECRETS } from '@/lib/config.server'
import { createServiceClient } from '@/lib/supabase/server'
import { recordingProviderFor } from '@/lib/messaging'

/**
 * A provider's reply, kept as data rather than `any`.
 *
 * The shape is the provider's to change, so nothing here claims to know it —
 * but `any` switched off checking at every point that touched it, and two of
 * this month's bugs were a field read off a response that did not have it.
 * Unknown values are read through explicit narrowing instead.
 */
export type ProviderReply = Record<string, unknown> | null


// WaSender API — https://wasenderapi.com
const WASENDER_URL = SECRETS.wasenderUrl || 'https://wasenderapi.com/api/send-message'

function normalizePhone(phone: string): string {
  /*
   * WaSender expects digits only in international form: 233XXXXXXXXX (their
   * own example sends no leading +, and some accounts reject it).
   *
   * The shared rule decides. This one had no validation at all, so
   * "00233241234567" was handed over as the sixteen-digit 2330233241234567 —
   * a number that cannot be delivered to and that nothing reported.
   *
   * The signature still returns a string, because the caller treats this as a
   * formatting step. When the number is not a Ghanaian mobile the digits are
   * passed through unchanged rather than mangled: the provider then refuses a
   * number that was already wrong, instead of one this function broke.
   */
  return canonicalGhanaMobile(phone) ?? String(phone).replace(/[^0-9]/g, '')
}

/**
 * Resolve which WaSender session (API key) to send through.
 * If a senderId (profile id) is given and that person has their own connected
 * WaSender session, use it — so the message comes from THEIR WhatsApp line.
 * Otherwise fall back to the central system key.
 */
async function resolveApiKey(senderId?: string | null): Promise<{ key: string; profileId: string | null }> {
  if (senderId) {
    try {
      const sb = createServiceClient()
      const { data } = await sb.from('profiles')
        .select('wasender_api_key, wasender_status')
        .eq('id', senderId)
        .maybeSingle()
      // Cleaned of a pasted newline, quotes or "Bearer " prefix — any of
      // which WasenderAPI answers with "invalid API key".
      const key = normaliseWasenderKey(data?.wasender_api_key as string | null)
      if (key) return { key, profileId: senderId }
    } catch {}
  }
  return { key: normaliseWasenderKey(SECRETS.wasenderApiKey), profileId: null }
}

async function wasenderSend(
  to: string,
  message: string,
  type: 'text' | 'media' = 'text',
  mediaUrl?: string,
  senderId?: string | null,
): Promise<boolean> {
  const phone = normalizePhone(to)

  /*
   * ── NO LINE CONFIGURED: RECORD, DO NOT FAIL ──────────────────────────────
   *
   * This used to log a failure and return false. That is right when a line is
   * supposed to exist and does not — and wrong while WhatsApp is deliberately
   * disconnected, which is the situation the centre is in now. Every message
   * failing meant every flow that follows a successful send was unreachable,
   * so nothing downstream of a WhatsApp message could be exercised at all.
   *
   * The recording provider takes it instead: the message is kept, the send
   * reports success so the business logic continues, and whatsapp_logs marks
   * it `recorded` rather than `sent` so no screen implies a person received
   * anything. Assistant readiness reports the channel as deferred, not broken.
   *
   * When WASENDER_API_KEY is set this branch is not taken and the real
   * provider sends, with no other change anywhere.
   */
  const recorder = recordingProviderFor('whatsapp')
  if (recorder) {
    const result = await recorder.send({
      to: phone, body: message, kind: type,
      mediaUrl: mediaUrl ?? null, senderId: senderId ?? null,
    })
    try {
      const sb = createServiceClient()
      await sb.from('whatsapp_logs').insert({
        recipient: phone, message, status: 'recorded',
        provider_response: { provider: recorder.id, detail: result.detail },
      })
    } catch { /* the recording is the point; the log is a nicety */ }
    return result.ok
  }

  const { key: apiKey, profileId } = await resolveApiKey(senderId)

  if (!apiKey) {
    console.error('[WaSender] No API key configured — set WASENDER_API_KEY')
    try {
      const sb = createServiceClient()
      await sb.from('whatsapp_logs').insert({
        recipient: phone, message, status: 'failed',
        provider_response: { error: 'No WaSender API key configured' },
      })
    } catch {}
    return false
  }

  // WaSender payload: { to, text } for text; media uses a *Url field alongside
  // the caption in `text`.
  const body: Record<string, any> = { to: phone, text: message }
  if (type === 'media' && mediaUrl) {
    const lower = mediaUrl.split('?')[0].toLowerCase()
    if (/\.(jpg|jpeg|png|gif|webp)$/.test(lower)) body.imageUrl = mediaUrl
    else if (/\.(mp4|mov|3gp)$/.test(lower)) body.videoUrl = mediaUrl
    else if (/\.(mp3|ogg|opus|m4a|wav)$/.test(lower)) body.audioUrl = mediaUrl
    else body.documentUrl = mediaUrl
  }

  let status = 'pending'
  let providerResponse: ProviderReply = null
  let failureKind: FailureKind | null = null

  try {
    const res = await fetch(WASENDER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const raw = await res.text()
    try { providerResponse = JSON.parse(raw) } catch { providerResponse = { raw: raw.slice(0, 400) } }
    // WaSender returns { success: true, data: {...} } on success
    status = res.ok && providerResponse?.success !== false ? 'sent' : 'failed'
    failureKind = status === 'sent' ? null : classifyWasender(res.status, providerResponse)
    if (status !== 'sent') console.error('[WaSender]', phone, res.status, providerResponse)
    return status === 'sent'
  } catch (e: unknown) {
    status = 'failed'
    const message = e instanceof Error ? e.message : String(e)
    providerResponse = { error: message }
    console.error('[WaSender] Error:', message)
    return false
  } finally {
    try {
      const sb = createServiceClient()
      /*
       * Keep the line's status honest — but only with what this send proves.
       * A delivered message proves the session is connected. A refused key or
       * a dead session proves it is not. A bad recipient, a rate limit or a
       * provider hiccup proves nothing about the line, and used to mark it
       * 'disconnected' anyway: one wrongly typed lead number could take a
       * working line off the screen.
       */
      if (profileId) {
        const kind = status === 'sent' ? null : failureKind
        const next = status === 'sent' ? 'connected'
          : kind === 'auth' ? 'invalid_key'
          : kind === 'session_not_connected' ? 'disconnected'
          : null
        if (next) {
          await sb.from('profiles').update({ wasender_status: next })
            .eq('id', profileId).then(() => {}, () => {})
        }
      }
      await sb.from('whatsapp_logs').insert({
        recipient: phone,
        message,
        status,
        provider_response: providerResponse,
      })
    } catch {}
  }
}

// ── Public API (unchanged surface — everything else keeps working) ─────────

export async function sendWhatsAppText(to: string, message: string, senderId?: string | null): Promise<boolean> {
  return wasenderSend(to, message, 'text', undefined, senderId)
}

export async function sendWhatsAppMedia(to: string, message: string, mediaUrl: string, senderId?: string | null): Promise<boolean> {
  // Never send a file that will not open. A dead link looks worse than saying
  // nothing, and people were receiving documents they could not read.
  if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) return false
  try {
    const head = await fetch(mediaUrl, { method: 'HEAD', signal: AbortSignal.timeout(6000) })
    if (!head.ok) return false
    const len = Number(head.headers.get('content-length') || '0')
    if (len > 0 && len < 100) return false      // effectively an empty file
  } catch {
    return false
  }

  return wasenderSend(to, message, 'media', mediaUrl, senderId)
}

// ── WhatsApp Message Templates ───────────────────────────────

export const WA = {
  /*
   * ── THIS USED TO POSE AS THE MARKETER ─────────────────────────────────
   *
   * It read "Hi Ama, I'm Ruth from Cambridge Center of Excellence" — for a
   * message Ruth had not written, sent automatically on every manual
   * assignment from /api/leads/assign and from lib/notifications.
   *
   * `marketerIntro` is the marketer's own wa_intro line, which makes it worse
   * rather than better: their real words, sent in their name, at a moment
   * they knew nothing about.
   *
   * It names Ruth as the colleague looking after them, and says what is
   * writing. The question at the end is unchanged — it is the one that makes
   * everything after it useful.
   */
  leadAssigned: (leadName: string, marketerName: string, courseInterest?: string | null) => {
    const first = (leadName || '').split(' ')[0] || 'there'
    const m = (marketerName || '').split(' ')[0]
    const course = courseInterest ? ` in *${courseInterest}*` : ''
    const helper = m
      ? `I'm the virtual assistant supporting ${m}, who is handling your enquiry`
      : `I'm the centre's virtual assistant`
    return `Hi ${first}, this is Cambridge Center of Excellence. ${helper}. I saw you showed interest in${course || ' our programmes'}. What do you currently do for work?`
  },

  applicationConfirmed: (name: string, course: string) =>
    `Hello ${name},\n\nWe have received your application for *${course}* at Cambridge Center of Excellence.\n\nOur admissions team will review your application and get back to you shortly.\n\nThank you for choosing us.`,

  admissionAccepted: (name: string, course: string, startDate: string) =>
    `Congratulations ${name},\n\nYour admission to *${course}* at Cambridge Center of Excellence has been confirmed.\n\nStart date: ${startDate}\n\nWelcome to the Cambridge family. We look forward to seeing you.`,

  classReminder1Week: (name: string, course: string, date: string, time: string, venue: string) =>
    `Hello ${name},\n\n*One week reminder*\n\nYour *${course}* class starts in one week.\n\nDate: ${date}\nTime: ${time}\nVenue: ${venue}\n\nPlease prepare your materials. See you soon.`,

  classReminder2Days: (name: string, course: string, date: string, time: string, venue: string, zoom?: string | null) =>
    `Hello ${name},\n\n*Two day reminder*\n\nYour *${course}* class is in two days.\n\nDate: ${date}\nTime: ${time}\nVenue: ${venue}${zoom ? `\nLink: ${zoom}` : ''}\n\nSee you there.`,

  classReminderDay: (name: string, course: string, time: string, venue: string, zoom?: string) =>
    `Hello ${name},\n\n*Class today*\n\nYour *${course}* class is today.\n\nTime: ${time}\nVenue: ${venue}${zoom ? `\nLink: ${zoom}` : ''}\n\nPlease arrive on time.`,

  paymentConfirmed: (name: string, amount: string, course: string, receipt: string) =>
    `Hello ${name},\n\n*Payment confirmed*\n\nWe have received your payment of *GHS ${amount}* for *${course}*.\n\nReceipt number: ${receipt}\n\nThank you.`,

  paymentReminder: (name: string, amount: string, course: string, dueDate: string) =>
    `Hello ${name},\n\n*Payment reminder*\n\nYou have an outstanding balance of *GHS ${amount}* for *${course}*.\n\nDue date: ${dueDate}\n\nPlease make payment to avoid disruption. Contact us for assistance.\n\nThank you.`,
}

// ── Convenience senders ──────────────────────────────────────

export async function notifyLeadAssigned(
  leadPhone: string, leadName: string, marketerName: string, senderId?: string | null,
  courseInterest?: string | null,
): Promise<boolean> {
  // marketerIntro is gone: it was the marketer's own wa_intro line, sent in
  // their name for a message they had not written. See WA.leadAssigned.
  return sendWhatsAppText(leadPhone, WA.leadAssigned(leadName, marketerName, courseInterest), senderId)
}

export async function notifyClassReminder(
  studentPhone: string, studentName: string, course: string,
  date: string, time: string, venue: string, daysUntil: number, zoom?: string, senderId?: string | null
): Promise<boolean> {
  let msg: string
  if (daysUntil <= 0) msg = WA.classReminderDay(studentName, course, time, venue, zoom)
  else if (daysUntil <= 2) msg = WA.classReminder2Days(studentName, course, date, time, venue, zoom)
  else msg = WA.classReminder1Week(studentName, course, date, time, venue)
  return sendWhatsAppText(studentPhone, msg, senderId)
}

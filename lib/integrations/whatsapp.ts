import { CONFIG } from '@/lib/config'
import { createServiceClient } from '@/lib/supabase/server'

// WaSender API — https://wasenderapi.com
const WASENDER_URL = CONFIG.wasenderUrl || 'https://wasenderapi.com/api/send-message'

function normalizePhone(phone: string): string {
  // WaSender expects digits only in international form: 233XXXXXXXXX
  // (their own example sends no leading +, and some accounts reject it).
  return String(phone)
    .replace(/[^0-9+]/g, '')
    .replace(/^\+/, '')
    .replace(/^0/, '233')
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
      if (data?.wasender_api_key) {
        return { key: data.wasender_api_key, profileId: senderId }
      }
    } catch {}
  }
  return { key: CONFIG.wasenderApiKey, profileId: null }
}

async function wasenderSend(
  to: string,
  message: string,
  type: 'text' | 'media' = 'text',
  mediaUrl?: string,
  senderId?: string | null,
): Promise<boolean> {
  const { key: apiKey, profileId } = await resolveApiKey(senderId)
  const phone = normalizePhone(to)

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
  let providerResponse: any = null

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
    if (status !== 'sent') console.error('[WaSender]', phone, res.status, providerResponse)
    return status === 'sent'
  } catch (e: any) {
    status = 'failed'
    providerResponse = { error: e.message }
    console.error('[WaSender] Error:', e.message)
    return false
  } finally {
    try {
      const sb = createServiceClient()
      // Keep the line's status honest: a successful send proves it's connected,
      // an auth/session failure proves it isn't. No manual testing required.
      if (profileId) {
        await sb.from('profiles')
          .update({ wasender_status: status === 'sent' ? 'connected' : 'disconnected' })
          .eq('id', profileId).then(() => {}, () => {})
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
  return wasenderSend(to, message, 'media', mediaUrl, senderId)
}

// ── WhatsApp Message Templates ───────────────────────────────

export const WA = {
  leadAssigned: (leadName: string, marketerName: string, courseInterest?: string | null, marketerIntro?: string | null) => {
    const first = (leadName || '').split(' ')[0] || 'there'
    const m = (marketerName || '').split(' ')[0] || 'your advisor'
    const course = courseInterest ? ` in *${courseInterest}*` : ''
    const intro = marketerIntro || `I'm ${m}`
    // Short, no sign-off, no corporate phrasing. It reads like a person.
    return `Hi ${first}, ${intro} from Cambridge Center of Excellence. I saw you showed interest in${course || ' our programmes'}. What do you currently do for work?`
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
  courseInterest?: string | null, marketerIntro?: string | null,
): Promise<boolean> {
  return sendWhatsAppText(leadPhone, WA.leadAssigned(leadName, marketerName, courseInterest, marketerIntro), senderId)
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

import { CONFIG } from '@/lib/config'
import { createServiceClient } from '@/lib/supabase/server'

// WAWP API — https://app.wawp.net
const WAWP_URL = 'https://app.wawp.net/api/send'

function normalizePhone(phone: string): string {
  // WAWP needs country code without +: 233XXXXXXXXX
  return phone
    .replace(/\s+/g, '')
    .replace(/^\+233/, '233')
    .replace(/^\+/, '')
    .replace(/^0/, '233')
}

interface Instance {
  instanceId: string
  accessToken: string
}

/**
 * Resolve which WhatsApp instance to send through.
 * If a senderId (a profile id) is given and that person has their own
 * connected WAWP instance, use it — so the message comes from THEIR line.
 * Otherwise fall back to the central system instance from CONFIG.
 */
async function resolveInstance(senderId?: string | null): Promise<Instance> {
  if (senderId) {
    try {
      const sb = createServiceClient()
      const { data } = await sb.from('profiles')
        .select('wawp_instance_id, wawp_access_token, wawp_status')
        .eq('id', senderId)
        .maybeSingle()
      if (data?.wawp_instance_id && data?.wawp_access_token && data?.wawp_status === 'connected') {
        return { instanceId: data.wawp_instance_id, accessToken: data.wawp_access_token }
      }
    } catch {}
  }
  return { instanceId: CONFIG.wawpInstanceId, accessToken: CONFIG.wawpAccessToken }
}

async function wawpSend(
  to: string,
  message: string,
  type: 'text' | 'media' = 'text',
  mediaUrl?: string,
  senderId?: string | null,
): Promise<boolean> {
  const { instanceId, accessToken } = await resolveInstance(senderId)
  const phone = normalizePhone(to)

  const body: Record<string, any> = {
    number: phone,
    type,
    message,
    instance_id: instanceId,
    access_token: accessToken,
  }
  if (type === 'media' && mediaUrl) body.media_url = mediaUrl

  let status = 'pending'
  let providerResponse: any = null

  try {
    const res = await fetch(WAWP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
    providerResponse = await res.json()
    status = res.ok && providerResponse?.status !== 'error' ? 'sent' : 'failed'
    console.log('[WAWP]', phone, status, providerResponse)
    return status === 'sent'
  } catch (e: any) {
    status = 'failed'
    providerResponse = { error: e.message }
    console.error('[WAWP] Error:', e.message)
    return false
  } finally {
    try {
      const sb = createServiceClient()
      await sb.from('whatsapp_logs').insert({
        recipient: phone,
        message,
        status,
        provider_response: providerResponse,
      })
    } catch {}
  }
}

// ── Public API ───────────────────────────────────────────────

export async function sendWhatsAppText(to: string, message: string, senderId?: string | null): Promise<boolean> {
  return wawpSend(to, message, 'text', undefined, senderId)
}

export async function sendWhatsAppMedia(to: string, message: string, mediaUrl: string, senderId?: string | null): Promise<boolean> {
  return wawpSend(to, message, 'media', mediaUrl, senderId)
}

// ── WhatsApp Message Templates ───────────────────────────────

export const WA = {
  leadAssigned: (leadName: string, marketerName: string, courseInterest?: string | null, marketerIntro?: string | null) => {
    const first = (leadName || '').split(' ')[0] || 'there'
    const m = (marketerName || '').split(' ')[0] || 'your advisor'
    const course = courseInterest ? ` in *${courseInterest}*` : ''
    const intro = marketerIntro || `I'm ${m}`
    return `Hello ${first}! Thank you so much for your interest in Cambridge Center of Excellence${course}.\n\n${intro}, and I'll personally be helping you through the process. I'll give you a quick call shortly so we can have a brief chat, and you can always reach me right here on WhatsApp anytime.\n\nIn the meantime, feel free to ask me any questions you have. I'm happy to help.`
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

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

async function wawpSend(
  to: string,
  message: string,
  type: 'text' | 'media' = 'text',
  mediaUrl?: string
): Promise<boolean> {
  const instanceId = process.env.WAWP_INSTANCE_ID!
  const accessToken = process.env.WAWP_ACCESS_TOKEN!
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

export async function sendWhatsAppText(to: string, message: string): Promise<boolean> {
  return wawpSend(to, message, 'text')
}

export async function sendWhatsAppMedia(to: string, message: string, mediaUrl: string): Promise<boolean> {
  return wawpSend(to, message, 'media', mediaUrl)
}

// ── WhatsApp Message Templates ───────────────────────────────

export const WA = {
  leadAssigned: (leadName: string, marketerName: string) =>
    `Hello ${leadName},\n\nThank you for your interest in *Cambridge Center of Excellence*.\n\n${marketerName} has been assigned to assist you and will contact you shortly.\n\nThank you. 🎓`,

  applicationConfirmed: (name: string, course: string) =>
    `Hello ${name},\n\nWe have received your application for *${course}* at Cambridge Center of Excellence.\n\nOur admissions team will review your application and get back to you shortly.\n\nThank you for choosing us! 🎓`,

  admissionAccepted: (name: string, course: string, startDate: string) =>
    `🎉 Congratulations ${name}!\n\nYour admission to *${course}* at Cambridge Center of Excellence has been confirmed.\n\n📅 Start Date: ${startDate}\n\nWelcome to the Cambridge family! We look forward to seeing you. 🎓`,

  classReminder1Week: (name: string, course: string, date: string, time: string, venue: string) =>
    `Hello ${name},\n\n⏰ *1 Week Reminder*\n\nYour *${course}* class starts in one week!\n\n📅 Date: ${date}\n🕐 Time: ${time}\n📍 Venue: ${venue}\n\nPrepare your materials and see you soon! 📚`,

  classReminder2Days: (name: string, course: string, date: string, time: string, venue: string, zoom?: string | null) =>
    `Hello ${name},\n\n⏰ *2 Days Reminder*\n\nYour *${course}* class is in 2 days!\n\n📅 Date: ${date}\n🕐 Time: ${time}\n📍 Venue: ${venue}${zoom ? `\n🔗 Zoom: ${zoom}` : ''}\n\nSee you there! 🎓`,

  classReminderDay: (name: string, course: string, time: string, venue: string, zoom?: string) =>
    `Hello ${name},\n\n🔔 *Class Today!*\n\nYour *${course}* class is TODAY!\n\n🕐 Time: ${time}\n📍 Venue: ${venue}${zoom ? `\n🔗 Zoom: ${zoom}` : ''}\n\nDon't be late! 🎓`,

  paymentConfirmed: (name: string, amount: string, course: string, receipt: string) =>
    `Hello ${name},\n\n✅ *Payment Confirmed*\n\nWe have received your payment of *GHS ${amount}* for *${course}*.\n\nReceipt No: ${receipt}\n\nThank you! 🎓`,

  paymentReminder: (name: string, amount: string, course: string, dueDate: string) =>
    `Hello ${name},\n\n💳 *Payment Reminder*\n\nYou have an outstanding balance of *GHS ${amount}* for *${course}*.\n\nDue Date: ${dueDate}\n\nPlease make payment to avoid disruption. Contact us for assistance.\n\nThank you. 🎓`,
}

// ── Convenience senders ──────────────────────────────────────

export async function notifyLeadAssigned(
  leadPhone: string, leadName: string, marketerName: string
): Promise<boolean> {
  return sendWhatsAppText(leadPhone, WA.leadAssigned(leadName, marketerName))
}

export async function notifyClassReminder(
  studentPhone: string, studentName: string, course: string,
  date: string, time: string, venue: string, daysUntil: number, zoom?: string
): Promise<boolean> {
  let msg: string
  if (daysUntil <= 0) msg = WA.classReminderDay(studentName, course, time, venue, zoom)
  else if (daysUntil <= 2) msg = WA.classReminder2Days(studentName, course, date, time, venue, zoom)
  else msg = WA.classReminder1Week(studentName, course, date, time, venue)
  return sendWhatsAppText(studentPhone, msg)
}

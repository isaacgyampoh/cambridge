import { createServiceClient } from '@/lib/supabase/server'

const ARKESEL_URL = 'https://sms.arkesel.com/api/v2/sms/send'
const ARKESEL_KEY = 'VXliSENVQnpsYkhWYlNpZkNRZEc'

export async function sendSMS(
  to: string | string[],
  message: string
): Promise<boolean> {
  const apiKey = process.env.ARKESEL_API_KEY || ARKESEL_KEY
  const senderId = process.env.ARKESEL_SENDER_ID || 'CambridgeCE'

  // Normalize to array of 233XXXXXXXXX format
  const recipients = (Array.isArray(to) ? to : [to]).map(num =>
    num.replace(/\s+/g, '').replace(/^\+233/, '233').replace(/^\+/, '').replace(/^0/, '233')
  )

  let status = 'pending'
  let providerResponse: any = null

  try {
    const res = await fetch(ARKESEL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({ sender: senderId, message, recipients }),
      signal: AbortSignal.timeout(10000),
    })

    providerResponse = await res.json()
    status = res.ok ? 'sent' : 'failed'
    console.log('[Arkesel SMS]', recipients, status, providerResponse)
    return res.ok
  } catch (e: any) {
    status = 'failed'
    providerResponse = { error: e.message }
    console.error('[Arkesel SMS] Error:', e.message)
    return false
  } finally {
    try {
      const sb = createServiceClient()
      await sb.from('sms_logs').insert(
        recipients.map(r => ({
          recipient: r,
          message,
          status,
          provider: 'arkesel',
          provider_response: providerResponse,
        }))
      )
    } catch {}
  }
}

// ── SMS Templates ────────────────────────────────────────────
export const SMS = {
  newLeadToPM: (leadName: string, source: string, count: number) =>
    `CCE Alert: New lead "${leadName}" from ${source}. You have ${count} unassigned lead(s). Assign now: ${process.env.NEXT_PUBLIC_APP_URL}/pm`,

  leadAssignedToMarketer: (marketerName: string, leadName: string) =>
    `CCE: Hi ${marketerName}, a new lead "${leadName}" has been assigned to you. View now: ${process.env.NEXT_PUBLIC_APP_URL}/marketer`,

  readyToJoinToOfficer: (officerName: string, studentName: string) =>
    `CCE: Hi ${officerName}, ${studentName} is ready to join a class. Process admission: ${process.env.NEXT_PUBLIC_APP_URL}/admission`,

  readyToJoinToAccountant: (studentName: string) =>
    `CCE: ${studentName} is ready to join. Awaiting registration fee. Check: ${process.env.NEXT_PUBLIC_APP_URL}/finance`,

  classReminder: (name: string, course: string, date: string, time: string, venue: string) =>
    `CCE Reminder: Hi ${name}, your ${course} class is on ${date} at ${time}. Venue: ${venue}. See you there!`,

  applicationReceived: (name: string) =>
    `CCE: Hi ${name}, we received your application. Our team will contact you shortly. Welcome to Cambridge!`,

  paymentConfirmed: (name: string, amount: string, receipt: string) =>
    `CCE: Payment of GHS ${amount} confirmed. Receipt: ${receipt}. Thank you, ${name}!`,
}

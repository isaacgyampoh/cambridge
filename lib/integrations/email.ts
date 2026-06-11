import { CONFIG } from '@/lib/config'
import { createServiceClient } from '@/lib/supabase/server'

const RESEND_URL = 'https://api.resend.com/emails'

async function sendEmail(to: string, subject: string, html: string, text?: string) {
  const apiKey = CONFIG.resendApiKey
  const from = CONFIG.resendFromEmail || 'Cambridge CE <noreply@cambridge.edu.gh>'

  if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY not set — skipping')
    return false
  }

  let status = 'pending'
  let providerResponse: any = null

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text }),
      signal: AbortSignal.timeout(10000),
    })
    providerResponse = await res.json()
    status = res.ok ? 'sent' : 'failed'
    return res.ok
  } catch (e: any) {
    status = 'failed'
    providerResponse = { error: e.message }
    return false
  } finally {
    try {
      const sb = createServiceClient()
      await sb.from('email_logs').insert({ recipient: to, subject, status, provider_response: providerResponse })
    } catch {}
  }
}

// ── Email Templates ──────────────────────────────────────────

export async function sendWelcomeEmail(to: string, name: string, course: string) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:#1e3a8a;padding:30px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:24px">Cambridge Centre of Excellence</h1>
      </div>
      <div style="background:white;padding:30px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px">
        <h2 style="color:#111827">Welcome, ${name}! 🎉</h2>
        <p style="color:#6b7280">Congratulations! Your application for <strong>${course}</strong> has been received.</p>
        <p style="color:#6b7280">Our admissions team will review your application and contact you within 24 hours.</p>
        <div style="background:#f3f4f6;padding:20px;border-radius:8px;margin:20px 0">
          <p style="margin:0;color:#374151"><strong>Next Steps:</strong></p>
          <ol style="color:#6b7280;margin:10px 0">
            <li>Our team will verify your application</li>
            <li>You will receive an offer letter via email</li>
            <li>Complete your registration fee payment</li>
            <li>Attend your orientation session</li>
          </ol>
        </div>
        <p style="color:#6b7280">For any questions, contact us via WhatsApp or call our office.</p>
        <p style="color:#374151;margin-top:30px">Best regards,<br><strong>Cambridge Centre of Excellence</strong></p>
      </div>
    </div>`
  return sendEmail(to, 'Welcome to Cambridge Centre of Excellence!', html)
}

export async function sendAdmissionLetter(to: string, name: string, course: string, admissionNo: string, startDate?: string) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:#1e3a8a;padding:30px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:24px">Admission Letter</h1>
        <p style="color:#93c5fd;margin:5px 0">Cambridge Centre of Excellence</p>
      </div>
      <div style="background:white;padding:30px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px">
        <p style="color:#6b7280">Dear <strong>${name}</strong>,</p>
        <p style="color:#6b7280">We are pleased to offer you admission to <strong>${course}</strong> at Cambridge Centre of Excellence.</p>
        <div style="background:#f0fdf4;border:1px solid #86efac;padding:20px;border-radius:8px;margin:20px 0">
          <p style="margin:0 0 8px;color:#166534"><strong>Admission Details</strong></p>
          <p style="margin:4px 0;color:#374151">Admission No: <strong>${admissionNo}</strong></p>
          <p style="margin:4px 0;color:#374151">Program: <strong>${course}</strong></p>
          ${startDate ? `<p style="margin:4px 0;color:#374151">Start Date: <strong>${startDate}</strong></p>` : ''}
        </div>
        <p style="color:#6b7280">Please complete your registration by paying the required fees and submitting all necessary documents.</p>
        <p style="color:#374151;margin-top:30px">Sincerely,<br><strong>Admissions Office</strong><br>Cambridge Centre of Excellence</p>
      </div>
    </div>`
  return sendEmail(to, `Admission Letter — ${course} | Cambridge CE`, html)
}

export async function sendPaymentReceipt(to: string, name: string, amount: string, receipt: string, course: string) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:#1e3a8a;padding:30px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:24px">Payment Receipt</h1>
      </div>
      <div style="background:white;padding:30px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px">
        <h2 style="color:#111827">Payment Confirmed ✅</h2>
        <p style="color:#6b7280">Dear ${name}, we have received your payment.</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;padding:20px;border-radius:8px;margin:20px 0">
          <p style="margin:4px 0;color:#374151">Receipt No: <strong>${receipt}</strong></p>
          <p style="margin:4px 0;color:#374151">Amount: <strong>GHS ${amount}</strong></p>
          <p style="margin:4px 0;color:#374151">Program: <strong>${course}</strong></p>
          <p style="margin:4px 0;color:#374151">Date: <strong>${new Date().toLocaleDateString('en-GH')}</strong></p>
        </div>
        <p style="color:#374151;margin-top:30px">Thank you,<br><strong>Cambridge Centre of Excellence</strong></p>
      </div>
    </div>`
  return sendEmail(to, `Payment Receipt ${receipt} — Cambridge CE`, html)
}

export async function sendClassReminder(to: string, name: string, course: string, date: string, time: string, venue: string, zoomLink?: string) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:#1e3a8a;padding:30px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:24px">Class Reminder</h1>
      </div>
      <div style="background:white;padding:30px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px">
        <h2 style="color:#111827">Hi ${name} 👋</h2>
        <p style="color:#6b7280">This is a reminder about your upcoming class:</p>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;padding:20px;border-radius:8px;margin:20px 0">
          <p style="margin:4px 0;color:#1e40af">📚 Course: <strong>${course}</strong></p>
          <p style="margin:4px 0;color:#1e40af">📅 Date: <strong>${date}</strong></p>
          <p style="margin:4px 0;color:#1e40af">🕐 Time: <strong>${time}</strong></p>
          <p style="margin:4px 0;color:#1e40af">📍 Venue: <strong>${venue}</strong></p>
          ${zoomLink ? `<p style="margin:4px 0;color:#1e40af">🔗 Zoom: <a href="${zoomLink}">${zoomLink}</a></p>` : ''}
        </div>
        <p style="color:#6b7280">Please ensure you are on time. See you there!</p>
        <p style="color:#374151;margin-top:30px">Cambridge Centre of Excellence</p>
      </div>
    </div>`
  return sendEmail(to, `Class Reminder: ${course} on ${date}`, html)
}

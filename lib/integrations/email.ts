import { CONFIG } from '@/lib/config'
import { createServiceClient } from '@/lib/supabase/server'

const RESEND_URL = 'https://api.resend.com/emails'

export async function sendEmail(to: string, subject: string, html: string, text?: string) {
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
 headers: { 'Authorization':`Bearer ${apiKey}`, 'Content-Type': 'application/json' },
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
 const html =`
 <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
 <div style="background:#1e3a8a;padding:30px;border-radius:12px 12px 0 0;text-align:center">
 <h1 style="color:white;margin:0;font-size:24px">Cambridge Centre of Excellence</h1>
 </div>
 <div style="background:white;padding:30px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px">
 <h2 style="color:#111827">Welcome, ${name}! </h2>
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
 const html =`
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
 ${startDate ?`<p style="margin:4px 0;color:#374151">Start Date: <strong>${startDate}</strong></p>` : ''}
 </div>
 <p style="color:#6b7280">Please complete your registration by paying the required fees and submitting all necessary documents.</p>
 <p style="color:#374151;margin-top:30px">Sincerely,<br><strong>Admissions Office</strong><br>Cambridge Centre of Excellence</p>
 </div>
 </div>`
 return sendEmail(to,`Admission Letter — ${course} | Cambridge CE`, html)
}

export async function sendPaymentReceipt(to: string, name: string, amount: string, receipt: string, course: string) {
 const html =`
 <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
 <div style="background:#1e3a8a;padding:30px;border-radius:12px 12px 0 0;text-align:center">
 <h1 style="color:white;margin:0;font-size:24px">Payment Receipt</h1>
 </div>
 <div style="background:white;padding:30px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px">
 <h2 style="color:#111827">Payment Confirmed </h2>
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
 return sendEmail(to,`Payment Receipt ${receipt} — Cambridge CE`, html)
}

export async function sendClassReminder(to: string, name: string, course: string, date: string, time: string, venue: string, zoomLink?: string) {
 const html =`
 <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
 <div style="background:#1e3a8a;padding:30px;border-radius:12px 12px 0 0;text-align:center">
 <h1 style="color:white;margin:0;font-size:24px">Class Reminder</h1>
 </div>
 <div style="background:white;padding:30px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px">
 <h2 style="color:#111827">Hi ${name} </h2>
 <p style="color:#6b7280">This is a reminder about your upcoming class:</p>
 <div style="background:#eff6ff;border:1px solid #bfdbfe;padding:20px;border-radius:8px;margin:20px 0">
 <p style="margin:4px 0;color:#1e40af"> Course: <strong>${course}</strong></p>
 <p style="margin:4px 0;color:#1e40af"> Date: <strong>${date}</strong></p>
 <p style="margin:4px 0;color:#1e40af"> Time: <strong>${time}</strong></p>
 <p style="margin:4px 0;color:#1e40af"> Venue: <strong>${venue}</strong></p>
 ${zoomLink ?`<p style="margin:4px 0;color:#1e40af"> Zoom: <a href="${zoomLink}">${zoomLink}</a></p>` : ''}
 </div>
 <p style="color:#6b7280">Please ensure you are on time. See you there!</p>
 <p style="color:#374151;margin-top:30px">Cambridge Centre of Excellence</p>
 </div>
 </div>`
 return sendEmail(to,`Class Reminder: ${course} on ${date}`, html)
}

/** Generic email sender — for ad-hoc messages (Zoom links, materials, etc.) */
export async function sendEmailGeneric(to: string, subject: string, html: string) {
  return sendEmail(to, subject, html)
}

// ── Login OTP ────────────────────────────────────────────────
export async function sendOTPEmail(to: string, name: string, code: string) {
  const first = (name || '').split(' ')[0] || 'there'
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#16202e">
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#8b97a8;font-weight:600">Cambridge Centre of Excellence</div>
    </div>
    <h1 style="font-size:20px;font-weight:600;margin:0 0 8px">Your login code</h1>
    <p style="font-size:14px;color:#45505f;line-height:1.6;margin:0 0 24px">Hi ${first}, use this code to finish signing in. It expires in 10 minutes.</p>
    <div style="background:#f6f7f9;border:1px solid #e4e8ee;border-radius:14px;padding:20px;text-align:center;margin-bottom:24px">
      <div style="font-size:34px;font-weight:700;letter-spacing:0.3em;color:#1c4d8c;font-family:monospace">${code}</div>
    </div>
    <p style="font-size:13px;color:#8b97a8;line-height:1.6;margin:0">If you didn't try to sign in, someone may have your PIN — change it once you're in, and tell your administrator. Never share this code with anyone.</p>
  </div>`
  const text = `Your Cambridge CE login code is ${code}. It expires in 10 minutes. If you didn't request it, change your PIN and tell your administrator.`
  return sendEmail(to, `${code} is your login code — Cambridge CE`, html, text)
}

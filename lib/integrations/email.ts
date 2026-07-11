import { CONFIG } from '@/lib/config'
import { createServiceClient } from '@/lib/supabase/server'
import nodemailer from 'nodemailer'

const RESEND_URL = 'https://api.resend.com/emails'

// Reuse one SMTP transporter across calls
let transporter: nodemailer.Transporter | null = null
function getTransporter() {
  if (transporter) return transporter
  if (!CONFIG.smtpHost || !CONFIG.smtpUser || !CONFIG.smtpPass) return null
  transporter = nodemailer.createTransport({
    host: CONFIG.smtpHost,
    port: CONFIG.smtpPort,
    secure: CONFIG.smtpSecure,
    auth: { user: CONFIG.smtpUser, pass: CONFIG.smtpPass },
  })
  return transporter
}

export async function sendEmail(to: string, subject: string, html: string, text?: string) {
  const from = CONFIG.resendFromEmail || 'Cambridge CE <portal@cambridge.edu.gh>'
  let status = 'pending'
  let providerResponse: any = null

  // 1) Prefer SMTP (the campus mailbox)
  const tx = getTransporter()
  if (tx) {
    try {
      const info = await tx.sendMail({ from, to, subject, html, text })
      status = 'sent'; providerResponse = { messageId: info.messageId, via: 'smtp' }
      return true
    } catch (e: any) {
      status = 'failed'; providerResponse = { error: e.message, via: 'smtp' }
    } finally {
      try { const sb = createServiceClient(); await sb.from('email_logs').insert({ recipient: to, subject, status, provider_response: providerResponse }) } catch {}
    }
  }

  // 2) Fallback: Resend (only if a key is set)
  if (CONFIG.resendApiKey) {
    status = 'pending'; providerResponse = null
    try {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${CONFIG.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject, html, text }),
        signal: AbortSignal.timeout(10000),
      })
      providerResponse = await res.json(); providerResponse.via = 'resend'
      status = res.ok ? 'sent' : 'failed'
      return res.ok
    } catch (e: any) {
      status = 'failed'; providerResponse = { error: e.message, via: 'resend' }
      return false
    } finally {
      try { const sb = createServiceClient(); await sb.from('email_logs').insert({ recipient: to, subject, status, provider_response: providerResponse }) } catch {}
    }
  }

  if (!tx) console.warn('[Email] No SMTP or Resend configured — skipping')
  return false
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
 const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
 const html =`
 <div style="font-family:Georgia,'Times New Roman',serif;max-width:640px;margin:0 auto;background:#ffffff">
   <div style="background:#1a7a85;padding:32px 40px;text-align:center">
     <h1 style="color:#ffffff;margin:0;font-size:22px;letter-spacing:0.5px;font-family:Arial,sans-serif">CAMBRIDGE CENTRE OF EXCELLENCE</h1>
     <p style="color:#bfe3e6;margin:6px 0 0;font-size:13px;font-family:Arial,sans-serif;letter-spacing:2px">LETTER OF ADMISSION</p>
   </div>
   <div style="padding:40px">
     <p style="color:#5a6675;margin:0 0 24px;font-size:13px;font-family:Arial,sans-serif">${today}</p>
     <p style="color:#1a2230;font-size:15px;line-height:1.7">Dear <strong>${name}</strong>,</p>
     <p style="color:#1a2230;font-size:15px;line-height:1.7">Following the successful completion of your registration, we are delighted to formally offer you admission into the following programme at Cambridge Centre of Excellence:</p>
     <div style="background:#f0f7f8;border-left:4px solid #1a7a85;padding:20px 24px;margin:24px 0">
       <table style="width:100%;font-family:Arial,sans-serif;font-size:14px;color:#1a2230">
         <tr><td style="padding:5px 0;color:#5a6675;width:150px">Admission Number</td><td style="padding:5px 0;font-weight:bold">${admissionNo}</td></tr>
         <tr><td style="padding:5px 0;color:#5a6675">Programme</td><td style="padding:5px 0;font-weight:bold">${course}</td></tr>
         <tr><td style="padding:5px 0;color:#5a6675">Candidate</td><td style="padding:5px 0;font-weight:bold">${name}</td></tr>
         ${startDate ? `<tr><td style="padding:5px 0;color:#5a6675">Start Date</td><td style="padding:5px 0;font-weight:bold">${startDate}</td></tr>` : ''}
       </table>
     </div>
     <p style="color:#1a2230;font-size:15px;line-height:1.7">Your registration fee has been received. Our team will be in touch shortly with your class schedule, learning materials, and joining details. Please keep your admission number safe — you will need it for all correspondence.</p>
     <p style="color:#1a2230;font-size:15px;line-height:1.7">We warmly welcome you to the Cambridge Centre of Excellence community and look forward to supporting your professional journey.</p>
     <p style="color:#1a2230;font-size:15px;line-height:1.7;margin-top:32px">Yours sincerely,</p>
     <p style="color:#1a2230;font-size:15px;line-height:1.5;margin-top:4px"><strong>Admissions Office</strong><br><span style="color:#5a6675;font-size:14px">Cambridge Centre of Excellence</span></p>
   </div>
   <div style="background:#fafbfc;padding:20px 40px;border-top:1px solid #eaedf1;text-align:center">
     <p style="color:#97a1b0;font-size:12px;font-family:Arial,sans-serif;margin:0">This is an official admission letter from Cambridge Centre of Excellence.<br>For enquiries, reply to this email or contact the Admissions Office.</p>
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

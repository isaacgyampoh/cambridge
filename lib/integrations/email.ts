import { SECRETS } from '@/lib/config.server'
import { BRAND } from '@/lib/brand'
import { createServiceClient } from '@/lib/supabase/server'
import nodemailer from 'nodemailer'

const RESEND_URL = 'https://api.resend.com/emails'

/**
 * Can this deployment send an email at all?
 *
 * ── WHY THIS IS NOT "IS RESEND CONFIGURED" ─────────────────────────────────
 *
 * SMTP is the PREFERRED transport here — the campus mailbox — and Resend is
 * only the fallback. A readiness check that asked about Resend alone reported
 * that staff could not receive a recovery code on a deployment where SMTP was
 * configured and working, which is exactly backwards: it named a blocker that
 * did not exist and sent somebody looking for a key they did not need.
 *
 * One predicate, so nothing has to remember which transport is preferred.
 */
export function emailConfigured(): boolean {
  return Boolean(
    (SECRETS.smtpHost && SECRETS.smtpUser && SECRETS.smtpPass) || SECRETS.resendApiKey,
  )
}

// Reuse one SMTP transporter across calls
let transporter: nodemailer.Transporter | null = null
function getTransporter() {
  if (transporter) return transporter
  if (!SECRETS.smtpHost || !SECRETS.smtpUser || !SECRETS.smtpPass) return null
  transporter = nodemailer.createTransport({
    host: SECRETS.smtpHost,
    port: SECRETS.smtpPort,
    secure: SECRETS.smtpSecure,
    auth: { user: SECRETS.smtpUser, pass: SECRETS.smtpPass },
  })
  return transporter
}

export async function sendEmail(to: string, subject: string, html: string, text?: string) {
  const from = SECRETS.resendFromEmail || 'Cambridge CE <portal@cambridge.edu.gh>'
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
  if (SECRETS.resendApiKey) {
    status = 'pending'; providerResponse = null
    try {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SECRETS.resendApiKey}`, 'Content-Type': 'application/json' },
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
 <h1 style="color:white;margin:0;font-size:24px">${BRAND.name}</h1>
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
 <p style="color:#374151;margin-top:30px">Best regards,<br><strong>${BRAND.name}</strong></p>
 </div>
 </div>`
 return sendEmail(to, `Welcome to ${BRAND.name}!`, html)
}

export async function sendUploadedAdmissionLetter(to: string, name: string, course: string, admissionNo: string, letterUrl: string) {
  // A short covering email that presents the admission letter the school
  // uploaded (not a generated template). The letter itself is the attachment/link.
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 28px;color:#10231C">
    <div style="background:#0B3B2E;padding:22px 28px;border-radius:12px 12px 0 0;text-align:center;margin:-32px -28px 24px">
      <h1 style="color:#fff;margin:0;font-size:18px;letter-spacing:0.3px">CAMBRIDGE CENTER OF EXCELLENCE</h1>
    </div>
    <p style="font-size:15px;line-height:1.7">Dear ${name},</p>
    <p style="font-size:15px;line-height:1.7">Congratulations! We are pleased to admit you to <b>${course}</b>.${admissionNo ? ` Your admission number is <b>${admissionNo}</b>.` : ''}</p>
    <p style="font-size:15px;line-height:1.7">Your official admission letter is attached below. Please download and keep it safe.</p>
    <p style="margin:22px 0"><a href="${letterUrl}" style="background:#0B3B2E;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:14px">Download your admission letter</a></p>
    <p style="font-size:14px;line-height:1.7;color:#5A6B64">We warmly welcome you to the ${BRAND.name} community.</p>
    <p style="font-size:14px;line-height:1.5;margin-top:20px">Sincerely,<br><b>Admissions Office</b><br>${BRAND.name}</p>
  </div>`
  return sendEmail(to, `Admission Letter — ${course} | ${BRAND.name}`, html)
}

export async function sendAdmissionLetter(to: string, name: string, course: string, admissionNo: string, startDate?: string, pdfUrl?: string) {
 const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
 const html =`
 <div style="font-family:Georgia,'Times New Roman',serif;max-width:640px;margin:0 auto;background:#ffffff">
   <div style="background:#0B3B2E;padding:32px 40px;text-align:center">
     <h1 style="color:#ffffff;margin:0;font-size:22px;letter-spacing:0.5px;font-family:Arial,sans-serif">CAMBRIDGE CENTER OF EXCELLENCE</h1>
     <p style="color:#bfe3e6;margin:6px 0 0;font-size:13px;font-family:Arial,sans-serif;letter-spacing:2px">LETTER OF ADMISSION</p>
   </div>
   <div style="padding:40px">
     <p style="color:#5A6B64;margin:0 0 24px;font-size:13px;font-family:Arial,sans-serif">${today}</p>
     <p style="color:#10231C;font-size:15px;line-height:1.7">Dear <strong>${name}</strong>,</p>
     <p style="color:#10231C;font-size:15px;line-height:1.7">Following the successful completion of your registration, we are delighted to formally offer you admission into the following programme at ${BRAND.name}:</p>
     <div style="background:#F6F8F7;border-left:4px solid #127A5A;padding:20px 24px;margin:24px 0">
       <table style="width:100%;font-family:Arial,sans-serif;font-size:14px;color:#10231C">
         <tr><td style="padding:5px 0;color:#5A6B64;width:150px">Admission Number</td><td style="padding:5px 0;font-weight:bold">${admissionNo}</td></tr>
         <tr><td style="padding:5px 0;color:#5A6B64">Programme</td><td style="padding:5px 0;font-weight:bold">${course}</td></tr>
         <tr><td style="padding:5px 0;color:#5A6B64">Candidate</td><td style="padding:5px 0;font-weight:bold">${name}</td></tr>
         ${startDate ? `<tr><td style="padding:5px 0;color:#5A6B64">Start Date</td><td style="padding:5px 0;font-weight:bold">${startDate}</td></tr>` : ''}
       </table>
     </div>
     <p style="color:#10231C;font-size:15px;line-height:1.7">Your registration fee has been received. Our team will be in touch shortly with your class schedule, learning materials, and joining details. Please keep your admission number safe — you will need it for all correspondence.</p>
     <p style="color:#10231C;font-size:15px;line-height:1.7">We warmly welcome you to the ${BRAND.name} community and look forward to supporting your professional journey.</p>
     <p style="color:#10231C;font-size:15px;line-height:1.7;margin-top:32px">Yours sincerely,</p>
     <p style="color:#10231C;font-size:15px;line-height:1.5;margin-top:4px"><strong>Admissions Office</strong><br><span style="color:#5A6B64;font-size:14px">${BRAND.name}</span></p>
     ${pdfUrl ? `<p style="margin:28px 0 4px"><a href="${pdfUrl}" style="background:#0B3B2E;color:#fff;text-decoration:none;padding:11px 22px;border-radius:10px;font-weight:600;font-size:14px;font-family:Arial,sans-serif">Download your admission letter (PDF)</a></p>` : ''}
   </div>
   <div style="background:#fafbfc;padding:20px 40px;border-top:1px solid #eaedf1;text-align:center">
     <p style="color:#97a1b0;font-size:12px;font-family:Arial,sans-serif;margin:0">This is an official admission letter from ${BRAND.name}.<br>For enquiries, reply to this email or contact the Admissions Office.</p>
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
 <p style="color:#374151;margin-top:30px">Thank you,<br><strong>${BRAND.name}</strong></p>
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
 <p style="color:#374151;margin-top:30px">${BRAND.name}</p>
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
      <div style="font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#8b97a8;font-weight:600">${BRAND.name}</div>
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

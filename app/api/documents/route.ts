import { sendEmail, emailConfigured } from '@/lib/integrations/email'
import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !['super_admin', 'project_manager', 'admissions_officer', 'receptionist'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
 const { documentId, studentIds } = await req.json()
 if (!documentId || !studentIds?.length) {
 return NextResponse.json({ error: 'Missing params' }, { status: 400 })
 }

 const sb = createServiceClient()

 const [{ data: doc }, { data: students }] = await Promise.all([
 sb.from('documents').select('*').eq('id', documentId).single(),
 sb.from('profiles').select('*').in('id', studentIds),
 ])

 if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

 /*
  * Sent through the campus mailbox, like every other message the portal
  * sends. This route used to call the Resend API directly with its own
  * fetch — a second email path that did not go through sendEmail, did not
  * write to email_logs, and would have kept using a third-party sender after
  * the rest of the portal had stopped.
  */
 if (!emailConfigured()) {
   return NextResponse.json({ error: 'Email is not configured — set SMTP_HOST, SMTP_USER and SMTP_PASS.' }, { status: 500 })
 }

 let sent = 0
  let failed = 0
 for (const student of students || []) {
 if (!student.email) continue

 // Send email with PDF link
 const subject =`${doc.name} — Cambridge Center of Excellence`
 const html =`
 <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
 <div style="background:#1e3a8a;padding:30px;border-radius:12px 12px 0 0;text-align:center">
 <h1 style="color:white;margin:0;font-size:22px">Cambridge Center of Excellence</h1>
 </div>
 <div style="background:white;padding:30px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px">
 <p style="color:#374151">Dear <strong>${student.full_name}</strong>,</p>
 <p style="color:#6b7280">Please find your <strong>${doc.name}</strong> attached via the link below:</p>
 <div style="text-align:center;margin:25px 0">
 <a href="${doc.file_url}" style="background:#1e3a8a;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">
 View / Download Document
 </a>
 </div>
 ${doc.description ?`<p style="color:#6b7280;font-size:14px">${doc.description}</p>` : ''}
 <p style="color:#374151;margin-top:30px">Best regards,<br><strong>Cambridge Center of Excellence</strong></p>
 </div>
 </div>
`

    /*
     * Resend's answer is read.
     *
     * This used to send and move straight on: the email_logs row was written
     * with status 'sent' and `sent` was incremented whatever came back. A
     * rejected address, an exhausted quota or a bad API key was recorded as a
     * delivered email and counted in the total reported to the operator —
     * "Documents sent to 30 of 30 students" for documents nobody received,
     * with a log that agreed.
     */
    let ok = false
    try {
      ok = await sendEmail(student.email, subject, html)
      // The reason goes to the server log, because email_logs has no column
      // for it — see below. It was being collected into a variable and then
      // dropped, which is the same as not knowing.
      if (!ok) console.error('[Documents] the mail server did not accept the message for', student.email)
    } catch (e) {
      console.error('[Documents] Email error for', student.email + ':', e)
    }

    /*
     * Logged as what actually happened, which is how anyone finds out later
     * that a document never arrived.
     *
     * Only the four columns this insert has always used. email_logs predates
     * supabase/migrations, so there is no schema here to check a new column
     * against — and naming one that does not exist fails the whole statement,
     * which is precisely how lead_assign_pending.last_sms_at silenced the
     * assignment notifications. The reason for a failure goes to the server
     * log above instead.
     */
    await sb.from('email_logs').insert({
      recipient: student.email,
      subject,
      template: doc.type,
      status: ok ? 'sent' : 'failed',
    }).then(() => {}, err => console.error('[Documents] could not log email:', err?.message))

    if (ok) sent++
    else failed++
  }

  return NextResponse.json({ success: true, sent, failed, total: sent + failed })
}

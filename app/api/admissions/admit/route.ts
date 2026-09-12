import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { sendAdmissionLetter } from '@/lib/integrations/email'
import { queueSMS } from '@/lib/notifications/sms'
import { recordAudit } from '@/lib/audit'
import { lookup, unavailable } from '@/lib/db/lookup'

export const runtime = 'nodejs'

/**
 * Admit a student. Sets the admission to 'admitted', generates an
 * admission number if missing, and AUTOMATICALLY sends the admission
 * letter by email (+ a short SMS). Body: { admissionId }
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid || !['super_admin', 'admissions_officer', 'project_manager'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const { admissionId } = await req.json()
  if (!admissionId) return NextResponse.json({ error: 'Missing admissionId' }, { status: 400 })

  const sb = createServiceClient()
  const { row: adm, failed } = await lookup(
    sb.from('admissions')
      .select('*, student:student_id(full_name, email, phone), course:course_id(name)')
      .eq('id', admissionId).maybeSingle(),
  )
  if (failed) return unavailable('[admissions/admit]', failed, 'that admission')
  if (!adm) return NextResponse.json({ error: 'Admission not found' }, { status: 404 })

  // Generate admission number if missing
  const admissionNo = adm.admission_number || `CCE/${new Date().getFullYear()}/${String(Math.floor(1000 + Math.random() * 9000))}`

  await sb.from('admissions').update({
    status: 'admitted',
    admission_number: admissionNo,
    admitted_at: new Date().toISOString(),
    admission_letter_sent: true,
  }).eq('id', admissionId)

  // Resolve student contact — prefer linked student, fall back to application
  let name = adm.student?.full_name, email = adm.student?.email, phone = adm.student?.phone
  const courseName = adm.course?.name || 'your programme'
  if (!email) {
    const { data: app } = await sb.from('applications')
      .select('full_name, email, phone, course:course_id(name)')
      .eq('lead_id', adm.lead_id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (app) { name = name || app.full_name; email = email || app.email; phone = phone || app.phone }
  }

  /*
   * Telling the student they have been admitted.
   *
   * Both of these were `try { … } catch {}`. If the admission letter failed to
   * send, nobody was told — not the officer who pressed the button, not the
   * logs, not the audit trail. The student simply never heard, and the record
   * said "admitted". That is the worst shape a failure can take in this
   * system: the outcome looks complete and a person is missing from it.
   */
  let emailed = false
  let emailError: string | null = null
  if (email) {
    try {
      await sendAdmissionLetter(email, name || 'Student', courseName, admissionNo)
      emailed = true
    } catch (e) {
      emailError = e instanceof Error ? e.message : 'Unknown error'
      console.error('[admit] admission letter not sent to', email, emailError)
    }
  }

  /*
   * The SMS goes through the queue, not a bare send.
   *
   * sendSMS makes one attempt and discards the result, which is how twenty-two
   * staff notifications were lost to provider timeouts. queueSMS persists the
   * job, retries with backoff, and shows up on /admin/sms-delivery — so "they
   * say they never got it" is answerable. The dedupe key means re-admitting
   * the same person cannot text them twice.
   */
  let smsQueued = false
  if (phone) {
    const result = await queueSMS({
      to: phone,
      message: `Congratulations ${(name || '').split(' ')[0]}! You have been admitted to ` +
        `${courseName} at Cambridge Center of Excellence. Admission No: ${admissionNo}. ` +
        `Check your email for your admission letter.`,
      kind: 'admission_letter',
      entityId: admissionId,
      dedupeKey: `admission:${admissionId}`,
    })
    smsQueued = result.queued || result.duplicate
  }

  await recordAudit({
    actorId: session.userId,
    action: 'admissions.admitted',
    resource: 'admissions',
    resourceId: admissionId,
    // Admitting succeeded; whether the student was REACHED is recorded
    // separately, because those are different facts.
    success: true,
    metadata: {
      admissionNo, courseName,
      emailed, emailError,
      smsQueued,
      hadEmail: Boolean(email), hadPhone: Boolean(phone),
    },
  })

  if (!emailed && !smsQueued) {
    console.error('[admit] student admitted but could not be contacted:', admissionId)
  }

  return NextResponse.json({
    success: true,
    admissionNo,
    emailed,
    smsQueued,
    // The caller is told plainly, so the screen can say so rather than
    // implying the student has been informed.
    contacted: emailed || smsQueued,
    warning: emailed || smsQueued
      ? undefined
      : 'The student was admitted, but no admission letter could be sent. Contact them directly.',
  })
}

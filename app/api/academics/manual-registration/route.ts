import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { completeApplication } from '@/lib/registration/complete'
import { lookup, unavailable, saveFailed } from '@/lib/db/lookup'
import { recordAudit } from '@/lib/audit'
import {
  validateRegistration, feeFor, phoneVariants, MANUAL_SOURCE,
} from '@/lib/academics/manualRegistration'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Register a student who never went through the portal.
 *
 * The whole point of this route is how LITTLE it does. It validates, checks
 * for a duplicate, writes one applications row, and then calls the same
 * completeApplication() the online flow calls. Admission numbering, the lead
 * chain, the fee ledger and the exam-prep enrolment all happen there, exactly
 * as they do for an online student, which is the only way the accountant's
 * screen and the class roster can see this student at all.
 *
 * No paystackRef is passed, ever. See lib/academics/manualRegistration.
 */

/*
 * Who may do this.
 *
 * The roles holding the `academics` portal, which is what grants
 * /admin/academics — so the people who can open the page are exactly the
 * people the route accepts. Any other pairing is a trap: a role that can see
 * the button and gets a 403, or one that can call the route but has no screen
 * for it.
 *
 * Narrower than /api/classes/enroll, which also admits a trainer. Seating
 * somebody in a class moves no money; this writes a fee ledger entry saying
 * what a student owes.
 *
 * An admissions officer is deliberately NOT here: they do not hold
 * `academics` and cannot reach the page. If they should, the portal grant and
 * this list change together — see lib/access/apiAccess.
 */
const ALLOWED = ['super_admin', 'administrator', 'project_manager']

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: { valid?: boolean; role?: string; userId?: string } =
    token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role || '')) {
    return NextResponse.json({ error: 'You are not permitted to register students.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = validateRegistration(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Some details need correcting.', fields: parsed.errors }, { status: 400 })
  }
  const v = parsed.value
  const sb = createServiceClient()

  // ── The programme must exist, and be one that is actually offered ────────
  const { row: course, failed: courseFailed } = await lookup(
    sb.from('courses')
      .select('id, name, course_fee, course_fee_online, is_active')
      .eq('id', v.courseId).maybeSingle(),
  )
  if (courseFailed) return unavailable('[academics/manual]', courseFailed, 'the programme list')
  if (!course) {
    return NextResponse.json({ error: 'Some details need correcting.', fields: { courseId: 'That programme no longer exists.' } }, { status: 400 })
  }
  if (course.is_active === false) {
    return NextResponse.json({ error: 'Some details need correcting.', fields: { courseId: 'That programme is no longer active.' } }, { status: 400 })
  }

  // ── A class, if one was chosen, and it must belong to this programme ─────
  if (v.batchId) {
    const { row: batch, failed: batchFailed } = await lookup(
      sb.from('batches').select('id, course_id').eq('id', v.batchId).maybeSingle(),
    )
    if (batchFailed) return unavailable('[academics/manual]', batchFailed, 'the class list')
    if (!batch) {
      return NextResponse.json({ error: 'Some details need correcting.', fields: { batchId: 'That class no longer exists.' } }, { status: 400 })
    }
    if (batch.course_id && batch.course_id !== v.courseId) {
      return NextResponse.json({ error: 'Some details need correcting.', fields: { batchId: 'That class belongs to a different programme.' } }, { status: 400 })
    }
  }

  /*
   * ── Already registered? ────────────────────────────────────────────────
   *
   * Matched on the phone number, in every shape it might have been stored
   * as, and narrowed to this programme: the same person legitimately takes a
   * second course, and refusing that would be worse than the duplicate it
   * prevents. A double-tap on Save lands here and is turned away.
   */
  const variants = phoneVariants(v.phone)
  const { data: clash, error: clashError } = await sb.from('applications')
    .select('id, full_name, course_id, created_at')
    .in('phone', variants).eq('course_id', v.courseId).limit(1)
  if (clashError) return unavailable('[academics/manual]', clashError.message, 'the existing registrations')
  if (clash?.length) {
    return NextResponse.json({
      error: `${clash[0].full_name || 'That student'} is already registered for ${course.name}.`,
      duplicate: true,
    }, { status: 409 })
  }

  /*
   * Did this person already exist as a lead? Asked BEFORE anything is
   * written, because the answer decides whether the lead's source may be set
   * to 'manual' afterwards. Somebody who came from Facebook months ago and is
   * registered at the desk today arrived from Facebook; overwriting that
   * would lose where they came from.
   */
  const { data: priorLeads } = await sb.from('leads').select('id').in('phone', variants).limit(1)
  const leadExistedBefore = Boolean(priorLeads?.length)

  // ── The application ──────────────────────────────────────────────────────
  const { data: application, error: appError } = await sb.from('applications').insert({
    full_name: v.fullName,
    email: v.email,
    phone: v.phone,
    gender: v.gender,
    date_of_birth: v.dateOfBirth,
    course_id: v.courseId,
    delivery: v.delivery,
    batch_preference: v.batchId,
    registration_source: MANUAL_SOURCE,
    /*
     * 'pending', never 'paid'. completeApplication reads this as isPaid, and
     * a false reading is what keeps the fee ledger at amount_paid 0, credits
     * no commission and leaves the admission pending. Registering a student
     * must not record money that nobody has received.
     */
    payment_status: 'pending',
    amount_paid: 0,
    is_submitted: true,
    submitted_at: new Date(v.registrationDate).toISOString(),
  }).select('id').single()

  if (appError || !application) {
    await recordAudit({
      actorId: session.userId, action: 'student.manual_register', resource: 'applications',
      success: false, metadata: { reason: appError?.message, course: course.name }, request: req,
    })
    return saveFailed('[academics/manual]', appError?.message || 'no row returned', 'that student')
  }

  // ── The canonical chain: lead, admission number, fee ledger, prep ────────
  const result = await completeApplication(application.id)

  if (!result.ok) {
    /*
     * Nothing downstream was created, so the application is a record of a
     * registration that did not happen. It is removed rather than left for
     * somebody to find — a half-registered student is worse than none, and
     * the operator is about to be told to try again.
     */
    await sb.from('applications').delete().eq('id', application.id).then(() => {}, () => {})
    await recordAudit({
      actorId: session.userId, action: 'student.manual_register', resource: 'applications',
      resourceId: application.id, success: false,
      metadata: { reason: result.reason, course: course.name }, request: req,
    })
    return NextResponse.json({
      error: result.reason || 'That student could not be registered. Nothing was saved — please try again.',
    }, { status: 503 })
  }

  /*
   * ── The accountant must be able to see them ────────────────────────────
   *
   * createFeeLedger swallows its own errors so that a fee problem can never
   * block a registration. That is right for the online flow and leaves a hole
   * here: a student created with no fee row is invisible on the accountant's
   * screen, and nothing would have said so. So it is verified, and written
   * once if it is missing, by the same rule.
   */
  const { data: fee } = await sb.from('student_fees')
    .select('id').eq('application_id', application.id).maybeSingle()

  let studentFeeId = fee?.id ?? null
  if (!studentFeeId) {
    const total = feeFor(course, v.delivery)
    const { data: made, error: feeError } = await sb.from('student_fees').insert({
      application_id: application.id,
      lead_id: null,
      student_name: v.fullName, email: v.email, phone: v.phone,
      course_id: v.courseId, course_name: course.name,
      delivery: v.delivery,
      total_fee: total, amount_paid: 0, balance: total,
      status: total > 0 ? 'owing' : 'paid',
    }).select('id').single()
    if (feeError) {
      console.error('[academics/manual] no fee ledger for', application.id, feeError.message)
    }
    studentFeeId = made?.id ?? null
  }

  // Fill in the lead the canonical path created, if it made one.
  const { data: withLead } = await sb.from('applications')
    .select('lead_id').eq('id', application.id).maybeSingle()
  const leadId = withLead?.lead_id ?? null

  if (leadId && studentFeeId) {
    await sb.from('student_fees').update({ lead_id: leadId })
      .eq('id', studentFeeId).is('lead_id', null).then(() => {}, () => {})
  }

  // A lead this registration brought into existence came from the desk.
  if (leadId && !leadExistedBefore) {
    await sb.from('leads').update({ source: MANUAL_SOURCE })
      .eq('id', leadId).then(() => {}, () => {})
  }

  /*
   * The class roster, if one was chosen. Upserted on the same conflict key
   * /api/classes/enroll uses, so registering twice cannot seat them twice.
   * No fee fields are written here: the money lives in student_fees, and
   * putting an amount on the enrolment too is how one student acquires two
   * balances.
   */
  let enrolled = false
  if (v.batchId && leadId) {
    const { error: enrolError } = await sb.from('class_enrollments').upsert({
      batch_id: v.batchId, application_id: application.id, lead_id: leadId,
      full_name: v.fullName, email: v.email, phone: v.phone, status: 'active',
    }, { onConflict: 'batch_id,application_id' })
    if (enrolError) console.error('[academics/manual] not seated in the class:', enrolError.message)
    else enrolled = true
  }

  if (v.notes) {
    await sb.from('lead_activities').insert({
      lead_id: leadId, activity_type: 'note',
      subject: 'Registered manually by academic staff',
      description: v.notes.slice(0, 2000),
    }).then(() => {}, () => {})
  }

  await recordAudit({
    actorId: session.userId, action: 'student.manual_register', resource: 'applications',
    resourceId: application.id, success: true,
    metadata: {
      course: course.name, delivery: v.delivery,
      admissionNumber: result.admissionNumber, feeRecorded: Boolean(studentFeeId),
      seatedInClass: enrolled, registrationDate: v.registrationDate,
    },
    request: req,
  })

  return NextResponse.json({
    success: true,
    applicationId: application.id,
    leadId,
    admissionNumber: result.admissionNumber ?? null,
    studentFeeId,
    seatedInClass: enrolled,
    /*
     * Said plainly rather than implied. If this is false the student exists
     * and the accountant cannot see them, and whoever registered them is the
     * only person in a position to notice.
     */
    visibleToAccounts: Boolean(studentFeeId),
  })
}

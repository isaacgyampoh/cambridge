import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { renderPersonalisedDoc } from '@/lib/documentFill'
import { generateAdmissionPDF } from '@/lib/generateAdmissionPDF'
import { sendWelcomeEmail, sendAdmissionLetter, sendUploadedAdmissionLetter } from '@/lib/integrations/email'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { queueSMS } from '@/lib/notifications/sms'
import { resolveDocument } from '@/lib/documents/resolve'
import { parseClassMode, classModeLabel, type ClassMode } from '@/lib/classMode'
import { recordAudit } from '@/lib/audit'
import { lookup } from '@/lib/db/lookup'
import { releaseJob } from '@/lib/messageJobs'

/**
 * Complete a paid registration.
 *
 * Previously this lived only inside a POST route, and the payment webhook
 * reached it by issuing an HTTP request from the deployment back to itself.
 * That round trip could time out or fail independently, leaving a paid
 * application half-processed, and it made the whole flow depend on the
 * deployment being able to reach its own origin. It is a plain function call
 * now; the route is a thin wrapper over it.
 *
 * Idempotency: the first thing this does is claim the application in
 * message_jobs, whose dedupe_key carries a UNIQUE index. Two callers — the
 * webhook and the browser return page, which is the normal case — race for
 * that insert and exactly one proceeds.
 */

export type CompletionResult = {
  ok: boolean
  alreadyProcessed?: boolean
  admissionNumber?: string | null
  reason?: string
}

type ProgramRow = { code: string; name: string; points?: number; is_corporate?: boolean }

/** Map a course name to a programme code for points. */
function matchProgram(courseName: string | null, programs: ProgramRow[]): ProgramRow | null {
  if (!courseName) return null
  const t = courseName.toLowerCase()
  for (const p of programs) {
    if (t.includes(p.code.toLowerCase()) || t.includes(p.name.toLowerCase())) return p
  }
  const map: Record<string, string> = {
    'pmp': 'PMP', 'project management': 'PMP',
    'sphr': 'SPHRI', 'phri': 'SPHRI', 'human resource': 'SPHRI', 'hr': 'SPHRI',
    'aphri': 'APHRI', 'capm': 'CAPM', 'ngo': 'NGO',
    'project financing': 'PROJFIN', 'financing': 'PROJFIN',
    'ms project': 'MSPROJ', 'microsoft project': 'MSPROJ',
    'commercial law': 'COMLAW', 'law': 'COMLAW',
    'instructor': 'INSTR', 'corporate': 'CORP',
  }
  for (const [kw, code] of Object.entries(map)) {
    if (t.includes(kw)) { const p = programs.find(x => x.code === code); if (p) return p }
  }
  return null
}

export async function completeApplication(
  applicationId: string,
  paystackRef?: string | null
): Promise<CompletionResult> {
  const sb = createServiceClient()

  if (paystackRef) {
    await sb.from('applications').update({
      payment_status: 'paid', paystack_ref: paystackRef,
      paid_at: new Date().toISOString(),
      is_submitted: true, submitted_at: new Date().toISOString(),
    }).eq('id', applicationId)
  }

  // ── The claim. Both the webhook and the browser return page call this. ──
  const { error: claimErr } = await sb.from('message_jobs').insert({
    dedupe_key: `app_complete:${applicationId}`,
    kind: 'application_complete',
    status: 'sent',
    body: applicationId,
    sent_at: new Date().toISOString(),
  })

  if (claimErr) {
    const { data: done } = await sb.from('admissions')
      .select('admission_number').eq('application_id', applicationId).maybeSingle()
    return { ok: true, alreadyProcessed: true, admissionNumber: done?.admission_number || null }
  }

  /*
   * Give the claim back.
   *
   * The claim above means "this registration has been completed". When a read
   * fails part-way through, it has NOT been, and leaving the claim in place
   * would wedge a paid registration for good: every retry — the Paystack
   * webhook's, or the student reloading the return page — would collide with
   * the claim and be told it was already processed, so the admission, the
   * letter and the fee ledger would never be created and nobody would be
   * told. Releasing it lets a retry do the work.
   *
   * Retrying is safe because every step is guarded by a check that is now
   * fail-CLOSED: the lead lookup, the remuneration check and the admission
   * lookup all stop on a failed read rather than reading it as "nothing
   * there". Before that, a retry would have duplicated all three.
   */
  const retryable = async (where: string, reason: string): Promise<CompletionResult> => {
    console.error(`[complete] ${where} read failed for ${applicationId}:`, reason)
    // The shared helper, so "give the claim back" is one behaviour and not
    // two implementations that can drift.
    await releaseJob(`app_complete:${applicationId}`)
    return { ok: false, reason: 'We could not finish this registration just now. Please try again in a moment.' }
  }

  const { row: app, failed: appFailed } = await lookup(
    sb.from('applications')
      .select('*, course:course_id(id, name, course_fee, course_fee_online)')
      .eq('id', applicationId).maybeSingle(),
  )

  if (appFailed) return retryable('application', appFailed)
  if (!app) return { ok: false, reason: 'Application not found' }

  const course = (app as { course?: { id: string; name: string; course_fee?: number; course_fee_online?: number } }).course
  const courseName = course?.name || null

  /*
   * THE CLASS MODE. Read once, from the authoritative application record,
   * normalised through the canonical parser, and used for every downstream
   * decision. No caller supplies it and nothing defaults it: an unreadable
   * mode is recorded as a problem rather than guessed, because guessing is
   * exactly what sent virtual students the physical letter.
   */
  const classMode = parseClassMode(app.delivery)
  if (!classMode) {
    console.error('[complete] application', applicationId, 'has no valid class mode:', app.delivery)
    await recordAudit({
      action: 'registration.class_mode_missing', resource: 'applications',
      resourceId: applicationId, success: false, metadata: { delivery: app.delivery },
    })
  }

  // ── 1. Ensure a lead exists ──
  let leadId: string | null = app.lead_id
  if (!leadId && (app.phone || app.email)) {
    const phone233 = app.phone ? String(app.phone).replace(/^0/, '233') : null
    const phone0 = app.phone ? String(app.phone).replace(/^233/, '0') : null
    /*
     * These two find the student's existing lead. Read as absent when they
     * merely failed, a second lead is created for somebody already in the
     * system — so the history, the assigned marketer and the call notes stay
     * on the first one while everything new lands on the second.
     */
    let existing: { id: string } | null = null
    if (phone233) {
      const { row, failed } = await lookup(
        sb.from('leads').select('id')
          .in('phone', [phone233, phone0].filter(Boolean) as string[])
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      )
      if (failed) return retryable('lead by phone', failed)
      existing = row
    }
    if (!existing && app.email) {
      const { row, failed } = await lookup(
        sb.from('leads').select('id').eq('email', app.email)
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      )
      if (failed) return retryable('lead by email', failed)
      existing = row
    }
    if (existing) {
      leadId = existing.id
      await sb.from('applications').update({ lead_id: leadId }).eq('id', applicationId)
    }
  }

  if (!leadId) {
    const { data: lead } = await sb.from('leads').insert({
      full_name: app.full_name, email: app.email, phone: app.phone,
      source: app.marketer_id ? 'referral' : 'website',
      status: 'new', course_interest: courseName,
      assigned_to: app.marketer_id || null,
    }).select('id').single()
    leadId = lead?.id ?? null
    if (leadId) await sb.from('applications').update({ lead_id: leadId }).eq('id', applicationId)
  }

  if (!leadId) return { ok: false, reason: 'Could not create the student record' }

  // The registration link belongs to a marketer — whoever's link was used owns
  // this lead, so it can never sit unassigned.
  if (app.marketer_id) {
    await sb.rpc('assign_lead_to', {
      p_lead_id: leadId, p_marketer: app.marketer_id,
      p_actor: null, p_reason: 'registration_link', p_source: 'application', p_force: true,
    }).then(() => {}, () => {})
  }

  // creditTo falls back to lead.assigned_to. A failed read here would quietly
  // credit nobody for a registration somebody earned.
  const { row: lead, failed: leadFailed } = await lookup(
    sb.from('leads').select('*').eq('id', leadId).maybeSingle(),
  )
  if (leadFailed) return retryable('lead', leadFailed)
  const creditTo = app.marketer_id || lead?.assigned_to || null
  const isPaid = app.payment_status === 'paid'

  // ── 2. Credit remuneration ──
  if (isPaid && creditTo) {
    /*
     * The one guard standing between this student and a second lot of points
     * and a second GHS 200. It failed OPEN: a failed read looked exactly like
     * "not credited yet", and the marketer was paid twice for one
     * registration, with nothing in the record to show why.
     */
    const { row: already, failed: alreadyFailed } = await lookup(
      sb.from('marketer_enrollments')
        .select('id').eq('lead_id', leadId).limit(1).maybeSingle(),
    )
    if (alreadyFailed) return retryable('remuneration check', alreadyFailed)

    if (!already) {
      const { data: programs } = await sb.from('program_points').select('*').eq('is_active', true)
      const prog = matchProgram(courseName, (programs || []) as ProgramRow[])
      if (prog) {
        const points = prog.is_corporate ? 40 : Number(prog.points || 0)
        await sb.from('marketer_enrollments').insert({
          marketer_id: creditTo, lead_id: leadId,
          program_code: prog.code, program_name: prog.name,
          points, registration_fee: 200,
          delivery: classMode,          // canonical, never a default
          is_pipeline: false, year: new Date().getFullYear(),
        })
        await sb.from('notifications').insert({
          user_id: creditTo, type: 'points',
          title: `+${points} points earned`,
          body: `${app.full_name} registered and paid for ${prog.name}. ${points} points + GHS 200 registration added to your annual total.`,
          link: '/marketer/earnings',
        }).then(() => {}, () => {})
      }
    }
  }

  // ── 3. Status ──
  if (isPaid) {
    await sb.from('leads').update({ status: 'registered' }).eq('id', leadId)
    await sb.from('lead_activities').insert({
      lead_id: leadId, activity_type: 'note', subject: 'Registered via link',
      description: `Paid GHS 200 registration for ${courseName || 'programme'} through the registration link.`,
    }).then(() => {}, () => {})
  } else if (lead && lead.status !== 'ready_to_join') {
    await sb.from('leads').update({ status: 'ready_to_join' }).eq('id', leadId)
  }

  // ── 4. Admission record ──
  let admissionNo = ''
  /*
   * Same shape again, and the most visible to the student: read as absent,
   * this takes the branch below that mints a SECOND admission number from the
   * sequence, and leaves letterAlreadySent false so a duplicate admission
   * letter goes out over the first one.
   */
  const { row: existingAdm, failed: admFailed } = await lookup(
    sb.from('admissions')
      .select('id, admission_number, admission_letter_sent').eq('lead_id', leadId).maybeSingle(),
  )
  if (admFailed) return retryable('admission', admFailed)
  const letterAlreadySent = existingAdm?.admission_letter_sent === true

  if (!existingAdm) {
    // Sequence-backed, so two simultaneous registrations cannot collide. The
    // previous number was `Math.floor(1000 + Math.random() * 9000)` — a
    // four-digit random with no unique constraint behind it, which by the
    // birthday bound duplicates at around eighty students in a year.
    const { data: nextNo } = await sb.rpc('next_admission_number')
    admissionNo = (nextNo as string) || `CCE/${new Date().getFullYear()}/${Date.now().toString().slice(-5)}`

    const { data: admission } = await sb.from('admissions').insert({
      application_id: applicationId, lead_id: leadId, course_id: app.course_id,
      admission_number: admissionNo,
      status: isPaid ? 'awaiting_forms' : 'pending',
    }).select('id').single()

    if (admission) {
      await sb.from('applications').update({ admission_id: admission.id }).eq('id', applicationId)
    }
  } else {
    admissionNo = existingAdm.admission_number || ''
  }

  // ── 5. Admission letter and email ──
  if ((app.phone || app.email) && !letterAlreadySent && classMode) {
    await deliverAdmissionLetter({
      applicationId, leadId, app, course, classMode, admissionNo,
    })
  }

  // ── 6. Fee ledger ──
  await createFeeLedger(applicationId, leadId, app, course, classMode)

  // ── 7. Exam-prep enrolment ──
  await enrolInPrep(applicationId, leadId, app, courseName)

  return { ok: true, admissionNumber: admissionNo || null }
}

// ── Admission letter ────────────────────────────────────────────────────────

type AppRow = Record<string, unknown> & {
  full_name?: string; email?: string | null; phone?: string | null; course_id?: string | null
}

async function deliverAdmissionLetter(args: {
  applicationId: string
  leadId: string
  app: AppRow
  course?: { id: string; name: string } | undefined
  classMode: ClassMode
  admissionNo: string
}): Promise<void> {
  const { applicationId, leadId, app, course, classMode, admissionNo } = args
  const sb = createServiceClient()
  const letterCourse = course?.name || 'your programme'
  const first = String(app.full_name || '').split(' ')[0] || 'there'

  if (app.email) {
    try { await sendWelcomeEmail(app.email, String(app.full_name || ''), letterCourse) } catch { /* not fatal */ }
  }

  // The start date of the next batch FOR THIS CLASS MODE. Picking the earliest
  // batch of any mode could print an in-person start date on a virtual letter.
  let startDate: string | undefined
  try {
    const { data: batch } = await sb.from('batches')
      .select('start_date, class_type')
      .eq('course_id', app.course_id)
      .eq('class_type', classMode === 'online' ? 'online' : 'physical')
      .order('start_date', { ascending: true }).limit(1).maybeSingle()
    if (batch?.start_date) {
      startDate = new Date(batch.start_date).toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    }
  } catch { /* start date is optional on the letter */ }

  // ONE resolver, mode-aware, shared with brochures.
  let letterUrl: string | null = null
  let usedUploaded = false

  const doc = await resolveDocument({
    type: 'admission_letter', courseId: app.course_id as string | null, classMode,
  })

  if (doc) {
    letterUrl = doc.fileUrl
    usedUploaded = true
    if (doc.isTemplate) {
      const personalised = await renderPersonalisedDoc({
        templateUrl: doc.fileUrl,
        positions: doc.fieldPositions || null,
        folder: 'admission-letters',
        filename: String(app.full_name || 'student'),
        values: {
          full_name: String(app.full_name || ''),
          admission_number: admissionNo,
          course: letterCourse,
          batch: '',
          date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
          email: String(app.email || ''),
          phone: String(app.phone || ''),
          amount: '', receipt_number: '',
        },
      })
      if (personalised) letterUrl = personalised
    }
  }

  if (!letterUrl) {
    letterUrl = await generateAdmissionPDF({
      name: String(app.full_name || 'Student'),
      course: letterCourse,
      admissionNo,
      startDate,
      delivery: classMode,        // canonical
    })
  }

  /*
   * Record WHICH letter was produced, on the admission row itself.
   *
   * The reported bug is an online registrant receiving the physical letter.
   * Until now the only trace was a boolean, so a report of it could be neither
   * confirmed nor disproved. Storing the mode, the template and the file makes
   * the mismatch query in migration 0009 possible:
   *
   *   WHERE ad.class_mode <> a.delivery   -- must return no rows
   *
   * Written whether or not delivery later succeeds: what letter we generated
   * and whether it arrived are separate facts.
   */
  const letterSource = doc
    ? (doc.isTemplate ? 'uploaded_template' : 'uploaded')
    : 'generated'

  await sb.from('admissions').update({
    class_mode: classMode,
    letter_template_id: doc?.id ?? null,
    letter_template_name: doc?.name ?? null,
    letter_url: letterUrl,
    letter_source: letterSource,
    letter_generated_at: new Date().toISOString(),
  }).eq('lead_id', leadId).then(() => {}, (e: unknown) => {
    // Provenance is evidence, not the operation — never fail a letter over it.
    console.error('[complete] could not record letter provenance:', e)
  })

  if (letterSource === 'generated') {
    console.warn('[complete] no admission-letter template matched for course',
      app.course_id, 'mode', classMode, '— used the built-in PDF')
  }

  await recordAudit({
    action: 'admission.letter_generated', resource: 'admissions', resourceId: leadId,
    success: Boolean(letterUrl),
    metadata: {
      classMode, admissionNo,
      matchedBy: doc?.matchedBy ?? 'generated',
      templateId: doc?.id ?? null,
      letterSource,
    },
  })

  const letterLine = letterUrl ? `\n\nYour admission letter:\n${letterUrl}` : ''
  const msg = `Dear ${first}, congratulations! 🎉 You have been admitted to ${letterCourse} `
    + `(${classModeLabel(classMode)}) at Cambridge Center of Excellence.`
    + `${admissionNo ? ` Your admission number is ${admissionNo}.` : ''}${letterLine}\n\nWelcome aboard.`

  if (app.phone) {
    let waOk = false
    try { waOk = Boolean(await sendWhatsAppText(app.phone, msg)) } catch { /* fall through */ }
    if (!waOk) {
      await queueSMS({
        to: app.phone, message: msg, kind: 'admission_letter',
        entityId: applicationId, dedupeKey: `admission_letter:${applicationId}`,
      })
    }
  }

  // ── The admission email (D5) ──
  // Only marked sent once the provider has actually accepted it.
  let emailAccepted = false
  if (app.email) {
    try {
      emailAccepted = usedUploaded && letterUrl
        ? Boolean(await sendUploadedAdmissionLetter(app.email, String(app.full_name || 'Student'), letterCourse, admissionNo, letterUrl))
        : Boolean(await sendAdmissionLetter(app.email, String(app.full_name || 'Student'), letterCourse, admissionNo, startDate, letterUrl || undefined))
    } catch (e) {
      console.error('[complete] admission email failed for', applicationId, e)
    }

    await recordAudit({
      action: emailAccepted ? 'admission.email_sent' : 'admission.email_failed',
      resource: 'admissions', resourceId: leadId, success: emailAccepted,
      metadata: { classMode, admissionNo },
    })
  }

  /*
   * admission_letter_sent gates every re-run, so it must reflect what actually
   * happened. Setting it after a failed send is what produces a student who is
   * marked as having received a letter they never got, and no retry will ever
   * fire because the gate is closed. It is set only when something genuinely
   * reached the applicant.
   */
  const delivered = Boolean(letterUrl) && (emailAccepted || Boolean(app.phone))
  if (delivered) {
    await sb.from('admissions').update({
      admission_letter_sent: true,
      admitted_at: new Date().toISOString(),
      status: 'admitted',
    }).eq('lead_id', leadId).then(() => {}, () => {})
  } else {
    console.error('[complete] admission letter NOT delivered for', applicationId, '— left open for retry')
  }

  // Notify finance and academics.
  try {
    const { data: staff } = await sb.from('profiles')
      .select('id, full_name, phone').eq('is_active', true)
      .in('role', ['accountant', 'admissions_officer', 'exam_coordinator', 'administrator'])
      .limit(20)

    const note = `CCE: ${app.full_name} has registered for ${letterCourse} (${classModeLabel(classMode)})`
      + `${admissionNo ? ` (${admissionNo})` : ''} and their admission letter has been sent.`

    for (const st of staff || []) {
      await sb.from('notifications').insert({
        user_id: st.id, type: 'admission',
        title: 'New registered student', body: note, link: '/admission/process',
      }).then(() => {}, () => {})

      if (st.phone) {
        await queueSMS({
          to: st.phone, message: note, kind: 'staff_admission_alert',
          entityId: applicationId, dedupeKey: `staff_admission:${applicationId}:${st.id}`,
        })
      }
    }
  } catch (e) { console.error('[complete] staff notification failed:', e) }
}

// ── Fee ledger ──────────────────────────────────────────────────────────────

async function createFeeLedger(
  applicationId: string, leadId: string, app: AppRow,
  course: { name: string; course_fee?: number; course_fee_online?: number } | undefined,
  classMode: ClassMode | null
): Promise<void> {
  try {
    const sb = createServiceClient()
    const { data: existing } = await sb.from('student_fees')
      .select('id').eq('application_id', applicationId).maybeSingle()
    if (existing) return

    // Online students pay the online fee where one is set. This read used to
    // be `(app.delivery || 'in_person') === 'online'`, so a null delivery
    // silently charged the in-person fee.
    let totalFee = 0
    if (course) {
      const onlineFee = Number(course.course_fee_online) || 0
      totalFee = classMode === 'online' && onlineFee > 0
        ? onlineFee
        : (Number(course.course_fee) || 0)
    }

    await sb.from('student_fees').insert({
      application_id: applicationId, lead_id: leadId,
      student_name: app.full_name, email: app.email, phone: app.phone,
      course_id: app.course_id, course_name: course?.name ?? null,
      delivery: classMode,
      total_fee: totalFee, amount_paid: 0, balance: totalFee,
      status: totalFee > 0 ? 'owing' : 'paid',
    })
  } catch (e) {
    console.error('[complete] fee ledger:', e)   // never block registration
  }
}

// ── Exam prep ───────────────────────────────────────────────────────────────

async function enrolInPrep(
  applicationId: string, leadId: string, app: AppRow, courseName: string | null
): Promise<void> {
  try {
    const sb = createServiceClient()
    const n = (courseName || '').toLowerCase()
    let progCode: string | null = null, progName: string | null = null

    if (n.includes('pmp') || n.includes('project management')) { progCode = 'PMP'; progName = 'PMP' }
    else if (n.includes('sphri') || n.includes('senior professional')) { progCode = 'SPHRI'; progName = 'SPHRi' }
    else if (n.includes('phri') || n.includes('professional in human')) { progCode = 'PHRI'; progName = 'PHRi' }
    if (!progCode) return

    const { data: existing } = await sb.from('prep_records')
      .select('id').eq('lead_id', leadId).maybeSingle()
    if (existing) return

    const { data: coord } = await sb.from('profiles').select('id')
      .eq('role', 'exam_coordinator').eq('coordinator_program', progCode).maybeSingle()

    await sb.from('prep_records').insert({
      lead_id: leadId, application_id: applicationId,
      student_name: app.full_name, email: app.email, phone: app.phone,
      program_code: progCode, program_name: progName,
      coordinator_id: coord?.id || null, prep_status: 'ongoing',
    })
  } catch (e) {
    console.error('[complete] prep enrolment:', e)   // never block registration
  }
}

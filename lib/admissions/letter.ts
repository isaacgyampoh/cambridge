import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { generateAdmissionPDF } from '@/lib/generateAdmissionPDF'
import { emailAdmissionLetter } from '@/lib/integrations/email'
import { classModeForLead } from '@/lib/registration/classModeForLead'
import { recordAudit } from '@/lib/audit'
import {
  blockingReason, feeForMode, registrationFee, letterDate, formatGHS, modeLabel,
  LETTER_TEMPLATE_VERSION, LETTER_TIMEZONE, type ClassMode, type CourseFees,
} from '@/lib/admissions/letterPolicy'

/**
 * THE ONLY PLACE AN ADMISSION LETTER CAN LEAVE THE SYSTEM.
 *
 * ── WHAT CHANGED ───────────────────────────────────────────────────────────
 *
 * Letters were sent automatically: on every paid registration (from the
 * Paystack callback, the webhook and the hourly reconcile cron), and again on
 * the Admit decision. The first path mailed a PDF straight out of the
 * document library — an old letter with old fees and no date.
 *
 * Both automatic paths are gone. A letter is now sent only when an authorised
 * person opens the admission, sees exactly what the letter will say, and
 * confirms. It is built at that moment from:
 *
 *   - the course's CURRENT fee for this student's study mode
 *   - today's date in Accra
 *   - the admission's own number and the student's own contact details
 *
 * and never from a stored document. If the fee cannot be established the
 * letter is refused, not guessed.
 */

export type LetterPreview = {
  admissionId: string
  studentName: string | null
  email: string | null
  programme: string | null
  mode: ClassMode | null
  modeLabel: string | null
  fee: string | null
  feeAmount: number | null
  registrationFee: string | null
  letterDate: string
  startDate: string | null
  admissionNumber: string | null
  status: string | null
  alreadySent: boolean
  sentAt: string | null
  /** Why it cannot be sent, when it cannot. */
  blocked: string | null
}

type LoadResult = { ok: true; preview: LetterPreview } | { ok: false; status: number; reason: string }

export async function prepareAdmissionLetter(admissionId: string): Promise<LoadResult> {
  const sb = createServiceClient()

  /*
   * Only columns that exist on every database this runs against. PostgREST
   * refuses the whole read if one is missing, and "the admission could not be
   * loaded" is a worse answer than a narrower read.
   */
  const { data: adm, error: admError } = await sb.from('admissions')
    .select('id, lead_id, student_id, course_id, admission_number, status, admission_letter_sent, offer_letter_sent_at')
    .eq('id', admissionId).maybeSingle()

  if (admError) return { ok: false, status: 503, reason: 'The admission could not be loaded just now. Please try again.' }
  if (!adm) return { ok: false, status: 404, reason: 'Admission not found.' }

  // Who the letter is for: the linked student, then their application, then the lead.
  let studentName: string | null = null
  let email: string | null = null
  if (adm.student_id) {
    const { data: p } = await sb.from('profiles').select('full_name, email').eq('id', adm.student_id).maybeSingle()
    studentName = (p?.full_name as string) || null
    email = (p?.email as string) || null
  }
  if ((!studentName || !email) && adm.lead_id) {
    const { data: app } = await sb.from('applications')
      .select('full_name, email').eq('lead_id', adm.lead_id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    studentName = studentName || (app?.full_name as string) || null
    email = email || (app?.email as string) || null
  }
  if ((!studentName || !email) && adm.lead_id) {
    const { data: lead } = await sb.from('leads').select('full_name, email').eq('id', adm.lead_id).maybeSingle()
    studentName = studentName || (lead?.full_name as string) || null
    email = email || (lead?.email as string) || null
  }

  // The CURRENT course record — the same columns the Courses screen edits.
  let course: CourseFees | null = null
  if (adm.course_id) {
    const { data: c, error: courseError } = await sb.from('courses')
      .select('id, name, course_fee, course_fee_online, registration_fee')
      .eq('id', adm.course_id).maybeSingle()
    // A failed read must not become "no fee" and then a refusal that blames
    // the course when the database was the problem.
    if (courseError) return { ok: false, status: 503, reason: 'The programme and its fees could not be loaded just now. Please try again.' }
    course = c as CourseFees | null
  }

  const mode = adm.lead_id ? await classModeForLead(adm.lead_id as string) : null
  const fee = feeForMode(course, mode)
  const reg = registrationFee(course)

  // The next cohort for THIS mode, if one is scheduled. Optional on the letter.
  let startDate: string | null = null
  if (adm.course_id && mode) {
    const { data: batch } = await sb.from('batches')
      .select('start_date')
      .eq('course_id', adm.course_id)
      .eq('class_type', mode === 'online' ? 'online' : 'physical')
      .gte('start_date', new Date().toISOString().slice(0, 10))
      .order('start_date', { ascending: true }).limit(1).maybeSingle()
    if (batch?.start_date) {
      startDate = new Date(`${batch.start_date}T12:00:00Z`).toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: LETTER_TIMEZONE,
      })
    }
  }

  const preview: LetterPreview = {
    admissionId,
    studentName,
    email,
    programme: course?.name ?? null,
    mode,
    modeLabel: mode ? modeLabel(mode) : null,
    fee: fee !== null ? formatGHS(fee) : null,
    feeAmount: fee,
    registrationFee: reg !== null ? formatGHS(reg) : null,
    letterDate: letterDate(),
    startDate,
    admissionNumber: (adm.admission_number as string) || null,
    status: (adm.status as string) || null,
    alreadySent: adm.admission_letter_sent === true,
    sentAt: (adm.offer_letter_sent_at as string) || null,
    blocked: blockingReason({
      studentName, email, course, mode,
      admissionNumber: (adm.admission_number as string) || null,
    }),
  }

  return { ok: true, preview }
}

export type SendResult =
  | { ok: true; pdfUrl: string; preview: LetterPreview; recorded: boolean }
  | { ok: false; status: number; reason: string; needsResendConfirmation?: boolean; preview?: LetterPreview }

/**
 * Build the letter from current data and, unless this is a review, email it.
 *
 * `review` produces the PDF so it can be read, and sends nothing and records
 * nothing as sent. `resend` is required when a letter has already gone, so
 * sending twice is a decision rather than a double tap.
 */
export async function issueAdmissionLetter(
  admissionId: string,
  actorId: string,
  opts: { review?: boolean; resend?: boolean } = {},
): Promise<SendResult> {
  const loaded = await prepareAdmissionLetter(admissionId)
  if (!loaded.ok) return loaded
  const p = loaded.preview

  // Re-checked here, not trusted from the preview the browser was shown.
  if (p.blocked) return { ok: false, status: 400, reason: p.blocked, preview: p }

  if (!opts.review && p.alreadySent && !opts.resend) {
    return {
      ok: false, status: 409, needsResendConfirmation: true, preview: p,
      reason: `An admission letter was already sent to this student${p.sentAt ? ` on ${letterDate(new Date(p.sentAt))}` : ''}. Confirm to send it again.`,
    }
  }

  const pdfUrl = await generateAdmissionPDF({
    name: p.studentName!,
    course: p.programme!,
    admissionNo: p.admissionNumber!,
    letterDate: p.letterDate,
    mode: p.modeLabel!,
    fee: p.fee!,
    registrationFee: p.registrationFee ?? undefined,
    startDate: p.startDate ?? undefined,
  })

  if (!pdfUrl) {
    return { ok: false, status: 502, reason: 'The admission letter could not be generated. Nothing was sent. Please try again.' }
  }

  if (opts.review) return { ok: true, pdfUrl, preview: p, recorded: false }

  const sent = await emailAdmissionLetter({
    to: p.email!,
    name: p.studentName!,
    course: p.programme!,
    admissionNo: p.admissionNumber!,
    letterDate: p.letterDate,
    mode: p.modeLabel!,
    fee: p.fee!,
    registrationFee: p.registrationFee,
    startDate: p.startDate,
    pdfUrl,
  })

  if (!sent) {
    await recordAudit({
      actorId, action: 'admission.letter_send_failed', resource: 'admissions',
      resourceId: admissionId, success: false,
      metadata: { recipient: p.email, programme: p.programme, fee: p.fee, letterDate: p.letterDate },
    })
    return { ok: false, status: 502, reason: 'The email provider did not accept the letter. Nothing was marked as sent. Please try again.' }
  }

  const sb = createServiceClient()
  const now = new Date().toISOString()

  /*
   * Recorded in two steps on purpose. The first uses columns every database
   * has; the second is provenance from migration 0009, written best-effort so
   * a database without it cannot make a letter that was sent read as unsent.
   */
  const { error: markError } = await sb.from('admissions')
    .update({ admission_letter_sent: true, offer_letter_sent_at: now })
    .eq('id', admissionId)

  await sb.from('admissions').update({
    letter_url: pdfUrl, letter_source: 'generated', letter_generated_at: now,
    class_mode: p.mode, letter_template_id: null, letter_template_name: LETTER_TEMPLATE_VERSION,
  }).eq('id', admissionId).then(() => {}, () => {})

  // The audit is the record of the document itself: what it said and who sent it.
  await recordAudit({
    actorId,
    action: 'admission.letter_sent',
    resource: 'admissions',
    resourceId: admissionId,
    success: true,
    metadata: {
      student: p.studentName,
      recipient: p.email,
      programme: p.programme,
      mode: p.modeLabel,
      fee: p.fee,
      feeAmount: p.feeAmount,
      registrationFee: p.registrationFee,
      letterDate: p.letterDate,
      admissionNumber: p.admissionNumber,
      templateVersion: LETTER_TEMPLATE_VERSION,
      pdfUrl,
      resend: Boolean(p.alreadySent),
      sentAt: now,
    },
  })

  if (markError) {
    console.error('[admission letter] sent but not marked as sent:', admissionId, markError.message)
  }

  return { ok: true, pdfUrl, preview: p, recorded: !markError }
}

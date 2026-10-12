import { parseClassMode, type ClassMode } from '../classMode.ts'
import { canonicalGhanaMobile } from '../phone.ts'
/*
 * Re-exported, not reimplemented. A local copy of this is how two paths come
 * to disagree about whether the same person is already on file — and
 * tests/oneSourceOfTruth caught exactly that when this file first grew its
 * own version. It covers more shapes than mine did, including the bare local
 * number.
 */
export { phoneVariants } from '../leads/importValidation.ts'

/**
 * Registering a student who never went through the portal.
 *
 * ── WHY THIS CREATES AN APPLICATION ────────────────────────────────────────
 *
 * Some students are signed up at the desk and never touch the online form.
 * The temptation is a "manual students" table, and it would be wrong: every
 * downstream thing in this portal is keyed to the chain an online
 * registration leaves behind.
 *
 *   applications -> leads -> admissions -> student_fees
 *
 * The accountant's screen reads student_fees. /api/classes/enroll takes an
 * applicationId. createFeeLedger de-duplicates on application_id. A student
 * recorded anywhere else is invisible to all three.
 *
 * So a manual registration creates a real application, marked as manual, and
 * then runs the SAME completeApplication() the online flow runs. Nothing here
 * reimplements admission numbering, fee assessment or the lead chain — it
 * assembles the input and lets the canonical path do the work. The only
 * things that live here are the parts that are genuinely new: what the form
 * must contain, and what counts as a duplicate.
 *
 * ── AND WHY IT NEVER RECORDS A PAYMENT ─────────────────────────────────────
 *
 * completeApplication takes an optional paystackRef, and passing one marks
 * the application paid. It is never passed from here. The application is
 * created 'pending', so isPaid is false all the way down: the fee ledger is
 * written with amount_paid 0 and the full balance owing, no commission is
 * credited to anybody, and the admission is 'pending'. Registering a student
 * states what they owe. The accountant records what they have paid, on the
 * screen that already exists for it.
 */

export type ManualRegistrationInput = {
  fullName?: unknown
  phone?: unknown
  email?: unknown
  gender?: unknown
  dateOfBirth?: unknown
  courseId?: unknown
  delivery?: unknown
  batchId?: unknown
  registrationDate?: unknown
  notes?: unknown
}

export type ValidRegistration = {
  fullName: string
  /** Canonical 233XXXXXXXXX. The one identity every other flow matches on. */
  phone: string
  email: string | null
  gender: string | null
  dateOfBirth: string | null
  courseId: string
  delivery: ClassMode
  batchId: string | null
  registrationDate: string
  notes: string | null
}

export type FieldErrors = Record<string, string>

const GENDERS = ['male', 'female', 'other'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Every field checked at once, so the form can show every problem together.
 *
 * Returning on the first failure makes somebody fix one field, submit, and be
 * told about the next — four times. The modal keeps what was typed, so the
 * errors have to arrive together for that to be worth anything.
 */
export function validateRegistration(input: ManualRegistrationInput): {
  ok: true; value: ValidRegistration
} | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {}

  const fullName = str(input.fullName)
  if (!fullName) errors.fullName = 'Enter the student’s full name.'
  else if (fullName.length < 2) errors.fullName = 'That name is too short.'
  else if (fullName.length > 120) errors.fullName = 'That name is too long.'

  /*
   * The phone is required and the email is not, which is the opposite of the
   * online form. It is the right way round here: the centre reaches students
   * on WhatsApp, every message route in this portal is keyed to a number, and
   * a student signed up at the desk frequently has no email at all. Storing a
   * made-up address to satisfy a column would put a real message somewhere it
   * cannot arrive.
   */
  const rawPhone = str(input.phone)
  const phone = canonicalGhanaMobile(rawPhone)
  if (!rawPhone) errors.phone = 'Enter a phone number.'
  else if (!phone) errors.phone = 'That is not a Ghana mobile number. Try 024… or 233…'

  const emailRaw = str(input.email)
  let email: string | null = null
  if (emailRaw) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailRaw)) errors.email = 'That email address does not look right.'
    else email = emailRaw.toLowerCase()
  }

  const genderRaw = str(input.gender).toLowerCase()
  let gender: string | null = null
  if (genderRaw) {
    if (!(GENDERS as readonly string[]).includes(genderRaw)) errors.gender = 'Choose a listed option.'
    else gender = genderRaw
  }

  const dobRaw = str(input.dateOfBirth)
  let dateOfBirth: string | null = null
  if (dobRaw) {
    if (!ISO_DATE.test(dobRaw) || Number.isNaN(Date.parse(dobRaw))) {
      errors.dateOfBirth = 'Use a real date.'
    } else if (Date.parse(dobRaw) > Date.now()) {
      errors.dateOfBirth = 'A date of birth cannot be in the future.'
    } else {
      dateOfBirth = dobRaw
    }
  }

  const courseId = str(input.courseId)
  if (!courseId) errors.courseId = 'Choose the programme.'
  else if (!UUID.test(courseId)) errors.courseId = 'That programme is not valid.'

  /*
   * Required, with no default. The fee depends on it — in person and online
   * are different prices — and defaulting it would charge somebody the wrong
   * amount silently. complete.ts carries the same note about a null delivery
   * having once charged the in-person fee by accident.
   */
  const delivery = parseClassMode(input.delivery)
  if (!delivery) errors.delivery = 'Choose whether they attend in person or online.'

  const batchRaw = str(input.batchId)
  let batchId: string | null = null
  if (batchRaw) {
    if (!UUID.test(batchRaw)) errors.batchId = 'That class is not valid.'
    else batchId = batchRaw
  }

  const dateRaw = str(input.registrationDate)
  let registrationDate = new Date().toISOString().slice(0, 10)
  if (dateRaw) {
    if (!ISO_DATE.test(dateRaw) || Number.isNaN(Date.parse(dateRaw))) {
      errors.registrationDate = 'Use a real date.'
    } else if (Date.parse(dateRaw) > Date.now() + 86400000) {
      errors.registrationDate = 'A registration cannot be dated in the future.'
    } else {
      registrationDate = dateRaw
    }
  }

  const notesRaw = str(input.notes)
  if (notesRaw.length > 2000) errors.notes = 'Keep the note under 2000 characters.'

  if (Object.keys(errors).length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      fullName, phone: phone as string, email, gender, dateOfBirth,
      courseId, delivery: delivery as ClassMode, batchId, registrationDate,
      notes: notesRaw || null,
    },
  }
}

/**
 * The fee for this student, by the institution's existing rule.
 *
 * Deliberately identical to createFeeLedger in lib/registration/complete.ts:
 * the online fee when the student is online AND one is set, the in-person fee
 * otherwise. It is restated here only so it can be tested without a database;
 * the registration itself goes through completeApplication and takes the fee
 * from there, so there is one writer, not two.
 */
export function feeFor(
  course: { course_fee?: unknown; course_fee_online?: unknown } | null | undefined,
  delivery: ClassMode,
): number {
  if (!course) return 0
  const online = Number(course.course_fee_online) || 0
  if (delivery === 'online' && online > 0) return online
  return Number(course.course_fee) || 0
}

export const MANUAL_SOURCE = 'manual'

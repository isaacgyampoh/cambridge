/**
 * THE RULES FOR ISSUING AN ADMISSION LETTER.
 *
 * Pure and import-free, so every rule here is unit tested directly.
 *
 * ── WHY THESE RULES EXIST ──────────────────────────────────────────────────
 *
 * Every paid registration used to be sent an admission letter automatically,
 * and the letter it sent was a stored PDF from the document library: an old
 * letter carrying old fees and no date. Nobody in Admissions saw it first.
 *
 * A letter is now issued only by an authorised person, built from the
 * current course record and today's date, and REFUSED rather than guessed
 * when the fee it must state cannot be established.
 */

export type ClassMode = 'online' | 'in_person'

/**
 * Who may issue an admission letter — and admit a student.
 *
 * The same three roles the Admit decision has always required. Stated once so
 * the decision and the letter cannot drift to different lists.
 */
export const ADMISSIONS_ROLES: readonly string[] = ['super_admin', 'admissions_officer', 'project_manager']

/** The operating timezone of the centre. Ghana is UTC+0 with no DST. */
export const LETTER_TIMEZONE = 'Africa/Accra'

export type CourseFees = {
  name?: string | null
  course_fee?: number | string | null
  course_fee_online?: number | string | null
  registration_fee?: number | string | null
}

function money(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

/**
 * The programme fee that applies to THIS student.
 *
 * In person reads course_fee; virtual reads course_fee_online — the columns
 * the Courses screen writes. There is deliberately no fallback from one to
 * the other: PMP is GHS 5,950 in person and 4,950 virtual, and printing the
 * in-person figure on a virtual student's letter because the virtual one was
 * blank is exactly the kind of wrong fee this exists to stop.
 */
export function feeForMode(course: CourseFees | null | undefined, mode: ClassMode | null): number | null {
  if (!course || !mode) return null
  return mode === 'online' ? money(course.course_fee_online) : money(course.course_fee)
}

export function registrationFee(course: CourseFees | null | undefined): number | null {
  return money(course?.registration_fee)
}

/** "22 September 2026", in Accra. Never blank, never a stored date. */
export function letterDate(now: Date = new Date()): string {
  return now.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: LETTER_TIMEZONE,
  })
}

export function formatGHS(amount: number): string {
  return `GHS ${amount.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export function modeLabel(mode: ClassMode): string {
  return mode === 'online' ? 'Virtual' : 'In-Person'
}

export type LetterInput = {
  studentName: string | null
  email: string | null
  course: CourseFees | null
  mode: ClassMode | null
  admissionNumber: string | null
}

/**
 * Why a letter cannot be issued, in words an admissions officer can act on.
 * Null when it can. Checked on the preview AND again on send.
 */
export function blockingReason(input: LetterInput): string | null {
  if (!input.studentName?.trim()) {
    return 'Admission letter cannot be sent because the student’s name is missing.'
  }
  if (!input.course?.name) {
    return 'Admission letter cannot be sent because the programme for this admission could not be determined.'
  }
  if (!input.mode) {
    return 'Admission letter cannot be sent because it is not known whether this student is in-person or virtual, so the correct fee cannot be chosen.'
  }
  if (feeForMode(input.course, input.mode) === null) {
    return `Admission letter cannot be sent because the current approved ${modeLabel(input.mode).toLowerCase()} fee for ${input.course.name} could not be determined. Set it on the Courses screen first.`
  }
  if (!input.admissionNumber?.trim()) {
    return 'Admission letter cannot be sent because this admission has no admission number yet. Admit the student first.'
  }
  const email = String(input.email || '').trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Admission letter cannot be sent because there is no valid email address for this student.'
  }
  return null
}

/** The version of the generated letter, recorded with every send. */
export const LETTER_TEMPLATE_VERSION = 'generated-v2-2026-09'

/*
 * One relative import, to lib/phone.ts, which is itself import-free — so this
 * module stays loadable by the node test runner, which does not resolve the
 * '@/' alias. The number rule is deliberately the SAME one the SMS sender
 * uses to dial, so a letter is never refused as unsendable to a number the
 * system would in fact have texted.
 */
import { canonicalGhanaMobile } from '../phone.ts'

/**
 * THE RULES FOR ISSUING AN ADMISSION LETTER.
 *
 * Pure, so every rule here is unit tested directly.
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
 * the other. The two modes cost different amounts, so printing the in-person
 * figure on a virtual student's letter because the virtual one was blank is
 * exactly the kind of wrong fee this exists to stop.
 *
 * The amounts are deliberately not named here: whatever is written in a
 * comment goes stale silently, and this file's whole purpose is to put the
 * CURRENT recorded fee on a letter.
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
  /** The other way to reach them. A letter is a link; a link can be texted. */
  phone: string | null
  course: CourseFees | null
  mode: ClassMode | null
  admissionNumber: string | null
}

/** A valid-enough address to send a document to. */
export function hasEmailAddress(email: string | null | undefined): boolean {
  const value = String(email || '').trim()
  return Boolean(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/** A number the SMS sender would actually dial. */
export function hasPhoneNumber(phone: string | null | undefined): boolean {
  return Boolean(canonicalGhanaMobile(phone))
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
  /*
   * ── REACHABLE, NOT MAILABLE ──────────────────────────────────────────────
   *
   * This refused any student without a valid email address. The letter was
   * email-only, so the refusal was at least honest — but it meant a student
   * who had given a phone number and no email could not be admitted at all,
   * and with the campus mailbox unconfigured that refusal was the only
   * possible outcome for everybody.
   *
   * The letter is a generated PDF at a URL. A URL can be sent by WhatsApp or
   * by text just as well as by email, so what has to be true is that there is
   * SOME way to reach them — and only an admission with no address and no
   * number is genuinely undeliverable.
   */
  if (!hasEmailAddress(input.email) && !hasPhoneNumber(input.phone)) {
    return 'Admission letter cannot be sent because this student has no email address and no phone number on file. Add one to their record first.'
  }
  return null
}

/**
 * ─── GETTING THE LETTER TO THE STUDENT ──────────────────────────────────────
 *
 * The letter is a generated PDF at a URL, and it went by email and only by
 * email. With the campus mailbox unconfigured that meant every send answered
 * "the email provider did not accept the letter" and no student could be sent
 * one at all.
 *
 * Three ways to deliver it now, in this order:
 *
 *   email     — the document itself, formatted, with the PDF attached by link
 *   whatsapp  — what the registration screen has always promised: "your
 *               admission letter is on its way by WhatsApp"
 *   sms       — the one that always works
 *
 * Email first because an admission letter IS a document and arrives as one.
 * The others carry a link to the same PDF, which is the whole letter.
 */
export type LetterChannel = 'email' | 'whatsapp' | 'sms'

export type LetterDestinations = { hasEmail: boolean; hasPhone: boolean }

/**
 * Which channels can carry this letter, in the order to try them.
 *
 * Two conditions for each, both required: somewhere to send it, and a sender
 * the deployment has configured. A channel missing either is not offered —
 * offering it would mark a letter as sent to a provider that was never going
 * to carry it, which is how a student ends up recorded as having received a
 * letter they have never seen.
 */
export function letterChannels(
  to: LetterDestinations,
  ready: { emailReady: boolean; whatsappReady: boolean; smsReady: boolean },
): LetterChannel[] {
  const out: LetterChannel[] = []
  if (to.hasEmail && ready.emailReady) out.push('email')
  if (to.hasPhone && ready.whatsappReady) out.push('whatsapp')
  if (to.hasPhone && ready.smsReady) out.push('sms')
  return out
}

/**
 * The message that carries the link.
 *
 * Names the programme and the admission number, because that is what the
 * student will be asked for in every exchange that follows, and because a
 * bare link from an unknown sender is a link nobody opens.
 */
export function letterNoticeText(
  studentName: string | null,
  programme: string | null,
  admissionNumber: string | null,
  url: string,
): string {
  const first = String(studentName || '').trim().split(' ')[0]
  return `${first ? first + ', c' : 'C'}ongratulations — you have been admitted`
    + `${programme ? ` to ${programme}` : ''} at Cambridge Center of Excellence.`
    + `${admissionNumber ? ` Your admission number is ${admissionNumber}.` : ''}`
    + ` Your admission letter: ${url}`
}

/**
 * "sent by text to 024 ••• 4567" — what to tell the officer who sent it.
 *
 * The screen said "Admission letter sent to <email address>" whatever
 * happened, which was true while email was the only channel. A letter that
 * went to a phone, announced as going to a mailbox, sends somebody looking in
 * an inbox for it — and then telling the student it was never sent.
 *
 * Pure, so the wording for every channel is exercised in a test rather than
 * read off the screen once and assumed.
 */
export function letterSentPhrase(via: LetterChannel | null, hint: string | null): string {
  if (!hint) return 'Admission letter sent'
  if (via === 'email') return `Admission letter emailed to ${hint}`
  if (via === 'whatsapp') return `Admission letter sent by WhatsApp to ${hint}`
  if (via === 'sms') return `Admission letter sent by text to ${hint}`
  return `Admission letter sent to ${hint}`
}

/** The version of the generated letter, recorded with every send. */
export const LETTER_TEMPLATE_VERSION = 'generated-v2-2026-09'

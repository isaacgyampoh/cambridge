import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  feeForMode, registrationFee, letterDate, blockingReason, formatGHS,
  ADMISSIONS_ROLES, LETTER_TIMEZONE,
} from '../lib/admissions/letterPolicy.ts'

/**
 * NO STUDENT RECEIVES AN ADMISSION LETTER BECAUSE THEY WERE APPROVED OR PAID.
 *
 * ── WHAT WAS HAPPENING ─────────────────────────────────────────────────────
 *
 * Three automatic paths sent admission letters:
 *
 *   1. completeApplication, step 5 — on every paid registration, from the
 *      Paystack callback, the webhook, and the hourly reconcile cron. It took
 *      an admission letter out of the document library and mailed the stored
 *      PDF as uploaded: an old letter with old fees and no date.
 *   2. /api/admissions/admit — the Admit decision emailed the letter in the
 *      same request and marked it sent before trying.
 *   3. onAdmitted in lib/notifications — no callers, but a working automatic
 *      sender waiting to be wired to an event.
 *
 * Nothing in the previous suite asserted any of this, which is how it ran
 * unnoticed. These tests make the rule structural: the letter sender can be
 * reached from exactly one module, and that module is only reachable from a
 * guarded route that demands confirmation.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

function allSource(): Array<{ path: string; src: string }> {
  const out: Array<{ path: string; src: string }> = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(p)) out.push({ path: p, src: codeOf(p) })
    }
  }
  walk('app'); walk('lib'); walk('components')
  return out
}

const source = allSource()
const complete = codeOf('lib/registration/complete.ts')
const admit = codeOf('app/api/admissions/admit/route.ts')
const letter = codeOf('lib/admissions/letter.ts')
const route = codeOf('app/api/admissions/letter/route.ts')
const email = codeOf('lib/integrations/email.ts')
const pdf = codeOf('lib/generateAdmissionPDF.ts')

/* ══ THE AUTOMATIC PATHS ARE GONE ═════════════════════════════════════════ */

describe('paying does not send an admission letter', () => {
  test('completion has no route to any letter sender', () => {
    for (const name of ['emailAdmissionLetter', 'generateAdmissionPDF', 'resolveDocument',
      'renderPersonalisedDoc', 'issueAdmissionLetter', 'deliverAdmissionLetter']) {
      assert.ok(!new RegExp(`\\b${name}\\b`).test(complete),
        `completeApplication can still reach ${name}`)
    }
  })

  test('nor does it message the student about admission at all', () => {
    assert.ok(!/sendWhatsAppText|queueSMS|sendEmail|sendWelcomeEmail/.test(complete))
  })

  test('the payment paths do not reach the letter module', () => {
    for (const path of ['app/api/paystack/verify/route.ts', 'app/api/paystack/reconcile/route.ts',
      'app/api/webhooks/paystack/route.ts', 'app/api/applications/complete/route.ts',
      'app/api/cron/run/route.ts']) {
      assert.ok(!/admissions\/letter|issueAdmissionLetter|emailAdmissionLetter/.test(codeOf(path)),
        `${path} can reach the admission letter`)
    }
  })

  test('no scheduled task points at a letter route', () => {
    const cron = codeOf('app/api/cron/run/route.ts')
    assert.ok(!/letter|admission/i.test(cron.slice(cron.indexOf('const TASKS'), cron.indexOf(']', cron.indexOf('const TASKS')))))
  })
})

describe('admitting does not send an admission letter', () => {
  test('the Admit route sends nothing to the student', () => {
    assert.ok(!/emailAdmissionLetter|generateAdmissionPDF|sendEmail|queueSMS|sendWhatsAppText|issueAdmissionLetter/.test(admit))
  })

  test('and no longer claims a letter went', () => {
    // It wrote admission_letter_sent: true before it had tried anything.
    assert.ok(!/admission_letter_sent/.test(admit))
    assert.match(admit, /letterSent: false/)
  })

  test('it still records the decision, and checks that it landed', () => {
    assert.match(admit, /status: 'admitted'/)
    assert.match(admit, /if \(updateError\) return saveFailed\(/)
  })
})

describe('the letter sender can be reached from exactly one place', () => {
  test('emailAdmissionLetter is called only by lib/admissions/letter.ts', () => {
    const callers = source
      .filter(f => /\bemailAdmissionLetter\(/.test(f.src))
      .map(f => f.path)
      .filter(p => !p.endsWith('lib/integrations/email.ts'))
    assert.deepEqual(callers, ['lib/admissions/letter.ts'])
  })

  test('issueAdmissionLetter is called only by the guarded route', () => {
    const callers = source
      .filter(f => /\bissueAdmissionLetter\(/.test(f.src))
      .map(f => f.path)
      .filter(p => !p.endsWith('lib/admissions/letter.ts'))
    assert.deepEqual(callers, ['app/api/admissions/letter/route.ts'])
  })

  test('the old senders no longer exist to be called', () => {
    // sendUploadedAdmissionLetter mailed the stored PDF as uploaded.
    assert.ok(!/export async function sendUploadedAdmissionLetter/.test(email))
    assert.ok(!/export async function sendAdmissionLetter/.test(email))
    assert.ok(!/export async function onAdmitted/.test(codeOf('lib/notifications/index.ts')))
  })

  test('no code anywhere mails an uploaded document as the letter', () => {
    for (const { path, src } of source) {
      assert.ok(!/resolveDocument\(\{[\s\S]{0,80}admission_letter/.test(src),
        `${path} resolves a stored admission letter`)
    }
  })
})

/* ══ THE MANUAL PATH ══════════════════════════════════════════════════════ */

describe('sending is deliberate', () => {
  test('a send must be confirmed', () => {
    assert.match(route, /if \(action === 'send' && confirm !== true\)/)
  })

  test('only the Admissions roles may send', () => {
    assert.match(route, /if \(!ADMISSIONS_ROLES\.includes\(s\.role \|\| ''\)\)/)
    assert.deepEqual([...ADMISSIONS_ROLES], ['super_admin', 'admissions_officer', 'project_manager'])
  })

  test('and the same roles decide admissions, from one list', () => {
    assert.match(admit, /ADMISSIONS_ROLES\.includes/)
  })

  test('a second send requires its own confirmation', () => {
    assert.match(letter, /if \(!opts\.review && p\.alreadySent && !opts\.resend\)/)
    assert.match(letter, /needsResendConfirmation: true/)
  })

  test('the screen will not send again without the box ticked', () => {
    const screen = codeOf('app/(portal)/admin/admissions/page.tsx')
    assert.match(screen, /letter\.alreadySent && !confirmResend/)
    assert.match(screen, /resend: letter\.alreadySent && confirmResend/)
  })

  test('a review builds the letter and sends nothing', () => {
    const idx = letter.indexOf('if (opts.review) return')
    const send = letter.indexOf('await emailAdmissionLetter(')
    assert.ok(idx > -1 && idx < send, 'review must return before the email is sent')
  })

  test('the checks are made again on send, not trusted from the preview', () => {
    const fn = letter.slice(letter.indexOf('export async function issueAdmissionLetter'))
    assert.match(fn, /const loaded = await prepareAdmissionLetter\(admissionId\)/)
    assert.match(fn, /if \(p\.blocked\) return/)
  })

  test('a failed email is not recorded as sent', () => {
    const fn = letter.slice(letter.indexOf('if (!sent) {'))
    const mark = letter.indexOf('admission_letter_sent: true')
    assert.ok(letter.indexOf('if (!sent) {') < mark)
    assert.match(fn.slice(0, 500), /return \{ ok: false/)
  })

  test('every send is audited with what the letter said', () => {
    assert.match(letter, /action: 'admission\.letter_sent'/)
    for (const field of ['recipient', 'programme', 'fee', 'letterDate', 'templateVersion', 'pdfUrl']) {
      assert.match(letter, new RegExp(`${field}[:,]`), `the audit does not record ${field}`)
    }
    assert.match(letter, /actorId,/)
  })
})

/* ══ CURRENT DATA, NEVER A STORED DOCUMENT ════════════════════════════════ */

describe('the letter is built from the current record', () => {
  test('the fee is read from the course now, not from a document', () => {
    assert.match(letter, /from\('courses'\)[\s\S]{0,80}course_fee, course_fee_online, registration_fee/)
    assert.ok(!/from\('documents'\)|resolveDocument/.test(letter))
  })

  test('the PDF is generated, and generation needs a fee and a date', () => {
    assert.match(letter, /await generateAdmissionPDF\(\{/)
    const iface = pdf.slice(pdf.indexOf('interface LetterData'), pdf.indexOf('}', pdf.indexOf('interface LetterData')))
    assert.match(iface, /letterDate: string/)
    assert.match(iface, /fee: string/)
    assert.ok(!/letterDate\?:|fee\?:/.test(iface), 'the date and fee must not be optional')
  })

  test('the PDF prints the supplied date, not its own', () => {
    assert.match(pdf, /page\.drawText\(data\.letterDate/)
    assert.ok(!/const today = new Date\(\)/.test(pdf))
  })

  test('the PDF prints the fee and the study mode', () => {
    assert.match(pdf, /row\('Programme Fee', data\.fee\)/)
    assert.match(pdf, /row\('Study Mode', data\.mode\)/)
  })

  test('neither the PDF nor the email claims a payment was received', () => {
    assert.ok(!/registration fee has been received/i.test(pdf))
    assert.ok(!/registration fee has been received/i.test(email))
  })

  test('the email states exactly the figures the PDF does', () => {
    const fn = email.slice(email.indexOf('export async function emailAdmissionLetter'))
    assert.match(fn, /args\.letterDate/)
    assert.match(fn, /row\('Programme Fee', args\.fee\)/)
    assert.ok(!/new Date\(\)/.test(fn), 'the email must not compute its own date')
  })

  test('student values are escaped into the email', () => {
    const fn = email.slice(email.indexOf('export async function emailAdmissionLetter'))
    assert.match(fn, /const esc = /)
    assert.match(fn, /esc\(args\.name\)/)
  })
})

describe('the fee for this student', () => {
  const pmp = { name: 'PMP', course_fee: 5950, course_fee_online: 4950, registration_fee: 200 }

  test('in person reads course_fee', () => {
    assert.equal(feeForMode(pmp, 'in_person'), 5950)
  })

  test('virtual reads course_fee_online', () => {
    assert.equal(feeForMode(pmp, 'online'), 4950)
  })

  test('a missing virtual fee is NOT filled from the in-person one', () => {
    assert.equal(feeForMode({ name: 'X', course_fee: 5950, course_fee_online: null }, 'online'), null)
  })

  test('a zero or blank fee is not a fee', () => {
    assert.equal(feeForMode({ name: 'X', course_fee: 0 }, 'in_person'), null)
    assert.equal(feeForMode({ name: 'X', course_fee: '' }, 'in_person'), null)
  })

  test('an unknown study mode has no fee', () => {
    assert.equal(feeForMode(pmp, null), null)
  })

  test('a changed fee is the fee used', () => {
    const before = feeForMode({ ...pmp }, 'in_person')
    const after = feeForMode({ ...pmp, course_fee: 6500 }, 'in_person')
    assert.equal(before, 5950)
    assert.equal(after, 6500)
  })

  test('the registration fee is read too', () => {
    assert.equal(registrationFee(pmp), 200)
    assert.equal(formatGHS(5950), 'GHS 5,950')
  })
})

describe('the date', () => {
  test('is today in Accra, in words', () => {
    assert.equal(letterDate(new Date('2026-09-22T09:00:00Z')), '22 September 2026')
    assert.equal(LETTER_TIMEZONE, 'Africa/Accra')
  })

  test('follows the clock, never a stored value', () => {
    assert.notEqual(letterDate(new Date('2026-09-22T12:00:00Z')), letterDate(new Date('2026-12-01T12:00:00Z')))
  })

  test('is never blank', () => {
    assert.ok(letterDate().length > 8)
  })
})

describe('a letter that cannot be stated correctly is refused', () => {
  const ok = {
    studentName: 'Ama Mensah', email: 'ama@example.com',
    course: { name: 'PMP', course_fee: 5950, course_fee_online: 4950 },
    mode: 'in_person' as const, admissionNumber: 'CCE/2026/00012',
  }

  test('a complete record is allowed', () => {
    assert.equal(blockingReason(ok), null)
  })

  test('no fee for the mode', () => {
    const r = blockingReason({ ...ok, mode: 'online', course: { name: 'PMP', course_fee: 5950, course_fee_online: null } })
    assert.match(r!, /current approved virtual fee for PMP could not be determined/)
  })

  test('the exact wording asked for is used', () => {
    const r = blockingReason({ ...ok, course: { name: 'PMP', course_fee: null } })
    assert.match(r!, /^Admission letter cannot be sent because the current approved/)
  })

  test('unknown study mode', () => {
    assert.match(blockingReason({ ...ok, mode: null })!, /in-person or virtual/)
  })

  test('no programme', () => {
    assert.match(blockingReason({ ...ok, course: null })!, /programme/)
  })

  test('no email', () => {
    assert.match(blockingReason({ ...ok, email: null })!, /no valid email/)
    assert.match(blockingReason({ ...ok, email: 'not-an-email' })!, /no valid email/)
  })

  test('not admitted yet', () => {
    assert.match(blockingReason({ ...ok, admissionNumber: null })!, /no admission number/)
  })
})

describe('what stays', () => {
  test('uploaded letters are not deleted, and are labelled reference-only', () => {
    const docs = readFileSync('app/(portal)/admin/documents/page.tsx', 'utf8')
    assert.match(docs, /kept for reference only and are never sent to students/)
    assert.match(docs, /value: 'admission_letter', label: 'Admission Letter'/)
  })

  test('the misleading coverage panel is gone', () => {
    const docs = codeOf('app/(portal)/admin/documents/page.tsx')
    assert.ok(!/Admission letter coverage/.test(docs))
  })

  test('the other emails are untouched', () => {
    for (const fn of ['sendOTPEmail', 'sendEmail', 'sendPaymentReceipt']) {
      assert.match(email, new RegExp(`export async function ${fn}\\(`), `${fn} is gone`)
    }
  })

  test('registration still creates the admission record', () => {
    assert.match(complete, /from\('admissions'\)\.insert\(/)
    assert.match(complete, /next_admission_number/)
  })
})

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  feeForMode, registrationFee, letterDate, blockingReason, formatGHS,
  ADMISSIONS_ROLES, LETTER_TIMEZONE,
  letterChannels,
  letterNoticeText,
  letterSentPhrase,
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
  test('emailAdmissionLetter is called from exactly one place', () => {
    /*
     * The property is "one door out", not "that particular door". The letter
     * now has three channels — email, WhatsApp, SMS — and choosing between
     * them is its own module, so the mail template is called from there
     * rather than from letter.ts. What must stay true is that there is a
     * single caller: a second one is a letter leaving the system without the
     * fee check, the admission-number check and the audit record.
     */
    const callers = source
      .filter(f => /\bemailAdmissionLetter\(/.test(f.src))
      .map(f => f.path)
      .filter(p => !p.endsWith('lib/integrations/email.ts'))
    assert.deepEqual(callers, ['lib/admissions/letterDelivery.ts'])
  })

  test('and so is every other way of sending the letter', () => {
    // The same rule for the two channels added with it.
    const callers = source
      .filter(f => /letterNoticeText\(/.test(f.src))
      .map(f => f.path)
      .filter(p => !p.endsWith('lib/admissions/letterPolicy.ts'))
    assert.deepEqual(callers, ['lib/admissions/letterDelivery.ts'])
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
    const send = letter.indexOf('await deliverLetter(')
    assert.ok(idx > -1 && send > -1 && idx < send,
      'review must return before anything is sent, on any channel')
  })

  test('the checks are made again on send, not trusted from the preview', () => {
    const fn = letter.slice(letter.indexOf('export async function issueAdmissionLetter'))
    assert.match(fn, /const loaded = await prepareAdmissionLetter\(admissionId\)/)
    assert.match(fn, /if \(p\.blocked\) return/)
  })

  test('a send that no channel accepted is not recorded as sent', () => {
    /*
     * The admission is marked as sent, the audit says so, and the officer is
     * told it has gone. If that happens on a failed send, the student never
     * gets their letter and nobody has any reason to look.
     */
    const guard = letter.indexOf('if (!delivery.sent) {')
    const mark = letter.indexOf('admission_letter_sent: true')
    assert.ok(guard > -1, 'the delivery result is no longer checked')
    assert.ok(guard < mark, 'the letter is marked as sent before the send is checked')
    assert.match(letter.slice(guard, guard + 600), /return \{ ok: false/)
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
    studentName: 'Ama Mensah', email: 'ama@example.com', phone: '0241234567',
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

  test('no way at all to reach them', () => {
    /*
     * This asked for a valid email address and refused anything else. The
     * letter was email-only, so the refusal was honest — but it meant a
     * student who had given a phone number and no email could not be admitted,
     * and with the campus mailbox unconfigured that was every student.
     *
     * The letter is a PDF at a URL, and a URL can be texted. So what must be
     * true is that there is SOME way to reach them; only an admission with
     * neither is genuinely undeliverable.
     */
    const neither = { ...ok, email: null, phone: null }
    assert.match(blockingReason(neither)!, /no email address and no phone number/)
    assert.match(blockingReason({ ...ok, email: 'not-an-email', phone: 'nonsense' })!,
      /no email address and no phone number/)
  })

  test('a phone number on its own is enough', () => {
    assert.equal(blockingReason({ ...ok, email: null }), null)
    assert.equal(blockingReason({ ...ok, email: 'not-an-email' }), null)
  })

  test('and an email address on its own is still enough', () => {
    assert.equal(blockingReason({ ...ok, phone: null }), null)
  })

  test('the number is judged by the rule the sender dials by', () => {
    /*
     * Not "is it non-empty". A letter must not be accepted as sendable to a
     * number the SMS sender would reject, because the student would then be
     * recorded as having been sent a letter that went nowhere.
     */
    assert.match(blockingReason({ ...ok, email: null, phone: '12345' })!, /no phone number/)
    assert.match(blockingReason({ ...ok, email: null, phone: '241234567' })!, /no phone number/)
    assert.equal(blockingReason({ ...ok, email: null, phone: '+233 24 123 4567' }), null)
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

/* ══ IT CAN ACTUALLY BE DELIVERED ═════════════════════════════════════════ */

/**
 * ─── A LETTER NOBODY COULD RECEIVE ──────────────────────────────────────────
 *
 * The letter went by email and only by email, and `blockingReason` refused
 * any student without a valid address. With the campus mailbox unconfigured
 * that meant every send answered "the email provider did not accept the
 * letter", and a student who had given a phone number and no email could not
 * be sent one at all — while the registration screen told them, in writing,
 * that their admission letter was on its way by WhatsApp.
 */
describe('the letter goes by whatever can carry it', () => {
  const delivery = codeOf('lib/admissions/letterDelivery.ts')
  const policy = codeOf('lib/admissions/letterPolicy.ts')

  test('email, then WhatsApp, then SMS', () => {
    /*
     * Email first because an admission letter is a document and should
     * arrive as one. The other two carry a link to the same PDF.
     */
    assert.deepEqual(
      letterChannels(
        { hasEmail: true, hasPhone: true },
        { emailReady: true, whatsappReady: true, smsReady: true },
      ),
      ['email', 'whatsapp', 'sms'],
    )
  })

  test('a channel with nowhere to send is not offered', () => {
    assert.deepEqual(
      letterChannels({ hasEmail: false, hasPhone: true }, { emailReady: true, whatsappReady: true, smsReady: true }),
      ['whatsapp', 'sms'],
    )
    assert.deepEqual(
      letterChannels({ hasEmail: true, hasPhone: false }, { emailReady: true, whatsappReady: true, smsReady: true }),
      ['email'],
    )
  })

  test('nor is one this deployment has not configured', () => {
    /*
     * The case that was live: a mailbox with no password, so email could not
     * send at all. The answer must be the channels that work, not "email,
     * and hope".
     */
    assert.deepEqual(
      letterChannels({ hasEmail: true, hasPhone: true }, { emailReady: false, whatsappReady: false, smsReady: true }),
      ['sms'],
    )
    assert.deepEqual(
      letterChannels({ hasEmail: true, hasPhone: true }, { emailReady: false, whatsappReady: true, smsReady: true }),
      ['whatsapp', 'sms'],
    )
  })

  test('nothing configured anywhere is an empty list, not a guess', () => {
    assert.deepEqual(
      letterChannels({ hasEmail: true, hasPhone: true }, { emailReady: false, whatsappReady: false, smsReady: false }),
      [],
    )
  })

  test('the senders are asked whether they are connected, not just tried', () => {
    /*
     * This is the subtle one, and it is the credential-recorder trap again.
     * With no API key, BOTH sendWhatsAppText and sendSMS hand the message to
     * a recording provider that keeps it and answers true. For a lead
     * notification that is deliberate. For a letter it would mark the
     * admission as sent, write the send into the audit trail and tell the
     * officer it had gone — while the student received nothing.
     */
    assert.match(delivery, /whatsappReady: whatsappConnected\(\)/)
    assert.match(delivery, /smsReady: smsConnected\(\)/)
    assert.match(delivery, /emailReady: emailConfigured\(\)/)
  })

  test('the notice names the programme and the admission number', () => {
    // A bare link from an unknown sender is a link nobody opens.
    const text = letterNoticeText('Ama Mensah', 'PMP', 'CCE/2026/00012', 'https://x/letter.pdf')
    assert.match(text, /^Ama, congratulations/)
    assert.match(text, /PMP/)
    assert.match(text, /CCE\/2026\/00012/)
    assert.match(text, /https:\/\/x\/letter\.pdf$/)
    assert.ok(!text.includes('Mensah'), 'a surname adds nothing on a lock screen')
  })

  test('and reads correctly with nothing to put in it', () => {
    const bare = letterNoticeText(null, null, null, 'https://x/l.pdf')
    assert.match(bare, /^Congratulations/)
    assert.ok(!/undefined|null/.test(bare))
  })

  test('a letter is reported as sent only when a channel took it', () => {
    /*
     * The admission is marked sent, the audit records it and the officer is
     * told. sent:true for a channel that was merely attempted is a student
     * who never receives their letter and nobody with a reason to look.
     */
    const lines = delivery.split('\n')
    const claims = lines.map((line, i) => ({ line, i })).filter(({ line }) => /sent: true/.test(line))
    assert.equal(claims.length, 1,
      'there must be one place that can claim a send — a second is a second chance to get it wrong')
    for (const { i } of claims) {
      const guard = lines.slice(0, i).reverse().find(l => /\bif \(/.test(l)) ?? ''
      assert.match(guard, /if \(await send\[channel\]\(\)\)/,
        'the nearest condition above sent:true is not a send that returned true')
    }
  })

  test('and the fall-through says plainly that it went nowhere', () => {
    const last = delivery.split('\n').filter(l => /return \{ sent:/.test(l)).pop() ?? ''
    assert.match(last, /sent: false, via: null, hint: null/)
  })

  test('a provider that throws costs that channel its turn, not the letter', () => {
    const lines = delivery.split('\n')
    const at = (re: RegExp) => lines.findIndex(l => re.test(l))
    const loop = at(/for \(const channel of order\)/)
    const tried = at(/^\s*try \{/)
    const caught = at(/\} catch \(e\) \{/)
    const pushed = at(/^\s*failed\.push\(channel\)/)
    assert.ok(loop >= 0 && tried > loop && caught > tried && pushed > caught)
    assert.ok(!/\b(throw|return)\b/.test(lines.slice(caught, pushed).join('\n')),
      'one throwing provider ends every attempt')
  })

  test('the refusal does not name a missing secret', () => {
    // It reaches an admissions officer, not an operator, and SMTP_PASS is
    // not something they can act on.
    assert.ok(!/SMTP|ARKESEL|WASENDER|API_KEY/.test(delivery))
    assert.match(delivery, /no email, WhatsApp or SMS sender is configured/)
  })

  test('the policy no longer treats a mailbox as the only way in', () => {
    assert.match(policy, /hasEmailAddress\(input\.email\) && !hasPhoneNumber\(input\.phone\)/)
    assert.ok(!/no valid email address for this student/.test(policy))
  })
})

describe('the screen says where the letter went', () => {
  const page = codeOf('app/(portal)/admin/admissions/page.tsx')

  test('every channel has its own words, and they are exercised here', () => {
    /*
     * The wording is a pure function so the test runs it, rather than
     * searching the page source for a phrase and calling that a check.
     */
    assert.equal(letterSentPhrase('email', 'i•••••@cambridge.edu.gh'),
      'Admission letter emailed to i•••••@cambridge.edu.gh')
    assert.equal(letterSentPhrase('whatsapp', '024 ••• 4567'),
      'Admission letter sent by WhatsApp to 024 ••• 4567')
    assert.equal(letterSentPhrase('sms', '024 ••• 4567'),
      'Admission letter sent by text to 024 ••• 4567')
  })

  test('and it never claims a destination it was not given', () => {
    // Naming the wrong place is worse than naming none.
    assert.equal(letterSentPhrase(null, null), 'Admission letter sent')
    assert.equal(letterSentPhrase('sms', null), 'Admission letter sent')
  })

  test('the screen uses it instead of naming the mailbox', () => {
    assert.ok(!/Admission letter sent to \$\{letter\.email\}/.test(page))
    assert.match(page, /toast\.success\(letterSentPhrase\(d\.via \?\? null, d\.sentTo \?\? null\)\)/)
  })

  test('and shows both destinations on the preview', () => {
    assert.match(page, /\[letter\.email, letter\.phone\]\.filter\(Boolean\)/)
  })

  test('the route passes the channel through', () => {
    const route = codeOf('app/api/admissions/letter/route.ts')
    assert.match(route, /via: result\.via/)
    assert.match(route, /sentTo: result\.sentTo/)
  })
})

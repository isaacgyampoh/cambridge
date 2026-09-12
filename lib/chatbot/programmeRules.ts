import { ghs } from './format.ts'

/**
 * A programme, and what is actually known about it.
 *
 * ── THIS IS THE TRUTH LAYER ────────────────────────────────────────────────
 *
 * The model is not the source of truth; this is. Every fee, date, venue and
 * brochure the assistant may mention comes from here, and anything absent
 * stays absent — never filled in, never inferred, never rendered as a
 * plausible-looking number.
 *
 * The type makes that structural rather than a matter of discipline. Every
 * fact is `| null`, and `capabilityOf` says what may therefore be offered. A
 * programme with no brochure cannot produce a brochure action, so the
 * assistant cannot offer one.
 *
 * Pure and dependency-free, because the property this file exists to hold —
 * that a fact absent from a row is absent from the message — must be provable
 * without a database or a model.
 */

export type Cohort = {
  name: string
  startDate: string | null
  startDateText: string | null
  schedule: string | null
  venue: string | null
  online: boolean
  running: boolean
}

export type Programme = {
  id: string
  name: string
  code: string | null
  description: string | null
  duration: string | null
  /** In-person fee. Null means nobody has recorded one. */
  feeInPerson: number | null
  feeOnline: number | null
  registrationFee: number | null
  brochureUrl: string | null
  cohorts: Cohort[]
}

/**
 * What may be offered for this programme.
 *
 * Derived from the record, never assumed. Section 6 of the brief: "If a
 * brochure does not exist, do not show 'See Brochure'."
 */
export type ProgrammeCapability = {
  canQuoteFee: boolean
  canShowSchedule: boolean
  canSendBrochure: boolean
  canRegister: boolean
}

/**
 * Is this a fee that can actually be stated?
 *
 * `!== null` was not enough. The Programme type says `number | null`, but a
 * row that arrives with the field absent gives `undefined`, which is not null
 * — so canQuoteFee came out true, ghs() then returned nothing for it, and the
 * description emitted a bare "Fee:" with no figure after it. An empty label
 * is worse than a stated absence: it tells the model a fee exists and leaves
 * it to supply one.
 *
 * Zero is excluded for the same reason it is excluded in the loader: it is an
 * empty field that happens to be numeric, not a programme given away free.
 */
function quotable(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

export function capabilityOf(p: Programme, registrationLink: string | null): ProgrammeCapability {
  return {
    canQuoteFee: quotable(p.feeInPerson) || quotable(p.feeOnline),
    canShowSchedule: p.cohorts.length > 0,
    canSendBrochure: Boolean(p.brochureUrl),
    // Registration is a real link belonging to a marketer. Without one there
    // is nowhere to send them, so the action is not offered.
    canRegister: Boolean(registrationLink),
  }
}

/**
 * The programme a lead is asking about.
 *
 * Exact code, then exact name, then the code as a whole word, then a
 * distinctive name fragment. Never a fuzzy best-guess: recommending the wrong
 * programme with confident detail is worse than asking which one they mean.
 */
export function matchProgramme(programmes: Programme[], interest: string | null | undefined): Programme | null {
  const raw = String(interest || '').trim()
  if (!raw || !programmes.length) return null

  const norm = (s: string | null) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const target = norm(raw)
  if (!target) return null

  const byCode = programmes.find(p => p.code && norm(p.code) === target)
  if (byCode) return byCode

  const byName = programmes.find(p => norm(p.name) === target)
  if (byName) return byName

  // The code as a whole word: "I want PMP training" finds PMP, and never
  // matches SPHR inside PHRi.
  const codeWord = programmes.filter(p => p.code
    && new RegExp(`\\b${String(p.code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(raw))
  if (codeWord.length === 1) return codeWord[0]

  // The whole stored name appearing in what they said.
  const nameIn = programmes.filter(p => norm(p.name).length >= 6 && target.includes(norm(p.name)))
  if (nameIn.length === 1) return nameIn[0]

  // A distinctive word from the programme name — "airbnb" finds the Airbnb
  // Management Masterclass. Only when exactly one programme claims it.
  const words = raw.toLowerCase().match(/[a-z]{4,}/g) || []
  const generic = new Set(['course', 'class', 'training', 'programme', 'program', 'masterclass', 'management', 'professional', 'certificate', 'want', 'interested', 'please', 'about'])
  for (const w of words) {
    if (generic.has(w)) continue
    const hits = programmes.filter(p => p.name.toLowerCase().includes(w))
    if (hits.length === 1) return hits[0]
  }

  return null
}

/** The next cohort that has not started, else the one running. */
export function nextCohort(p: Programme): Cohort | null {
  const upcoming = p.cohorts.filter(c => !c.running && c.startDate)
  if (upcoming.length) return upcoming[0]
  return p.cohorts[0] || null
}

/**
 * The programme, written out for the model — and ONLY what is known.
 *
 * Each absent fact is stated as absent rather than omitted, so the model is
 * told plainly that it has no fee rather than left to notice one is missing.
 */
export function describeProgramme(p: Programme, cap: ProgrammeCapability): string {
  const lines: string[] = [`PROGRAMME: ${p.name}${p.code ? ` (${p.code})` : ''}`]

  if (p.description) lines.push(`What it covers: ${p.description}`)
  if (p.duration) lines.push(`Duration: ${p.duration}`)

  const parts: string[] = []
  if (quotable(p.feeInPerson)) parts.push(`${ghs(p.feeInPerson)} in person`)
  if (quotable(p.feeOnline)) parts.push(`${ghs(p.feeOnline)} online`)

  // `parts.length`, not `cap.canQuoteFee`: the two agree, and depending on the
  // list that is actually about to be printed means a bare "Fee:" cannot be
  // emitted however the two ever drift apart.
  if (parts.length) {
    lines.push(`Fee: ${parts.join(', ')}`)
    if (quotable(p.registrationFee)) lines.push(`Registration fee: ${ghs(p.registrationFee)}`)
  } else {
    lines.push('Fee: NOT RECORDED. You do not know this programme\'s fee. Do not state one, do not estimate, do not compare it to another programme. Say you will have it confirmed.')
  }

  if (cap.canShowSchedule) {
    lines.push('Cohorts:')
    for (const c of p.cohorts.slice(0, 5)) {
      lines.push(`  - ${c.online ? 'online' : c.venue ? `in person, ${c.venue}` : 'in person'}`
        + `${c.startDateText ? `, starts ${c.startDateText}` : ', start date not set'}`
        + `${c.schedule ? `, ${c.schedule}` : ''}`
        + `${c.running ? ' (already running)' : ''}`)
    }
  } else {
    lines.push('Cohorts: NONE SCHEDULED. You do not know when this next runs. Do not name a date.')
  }

  lines.push(cap.canSendBrochure
    ? 'Brochure: available, and you may offer to send it.'
    : 'Brochure: NOT available. Do not offer one.')

  return lines.join('\n')
}

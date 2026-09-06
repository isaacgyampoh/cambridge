import { parseClassMode, classModeLabel } from '../classMode.ts'

/**
 * One vocabulary for every status the product shows a person.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Labels were being invented per screen. `lib/utils/index.ts` held a map for
 * lead statuses only, as raw Tailwind class strings; every other domain —
 * class mode, payments, SMS, import outcomes — was spelled out inline
 * wherever it happened to be needed.
 *
 * That is not a cosmetic problem. Class mode is the case that already cost
 * real money: the same student's registration read "Online" on one screen,
 * "Virtual" on another and "physical" on the batch, and a physical admission
 * letter went out to someone who had enrolled online. Two names for one thing
 * is how a person makes a wrong decision confidently.
 *
 * So the label is derived, never typed. A screen asks what a value MEANS and
 * gets back the label, the tone and — where it helps — a sentence explaining
 * it. Adding a screen cannot introduce a new name for an existing state.
 *
 * Pure and dependency-free: no React, no styling, so the vocabulary is under
 * test rather than trusted.
 */

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'muted'

export type StatusDescriptor = {
  /** What a person reads. Sentence case, never a raw enum. */
  label: string
  tone: Tone
  /** A short explanation, where the label alone is not self-evident. */
  hint?: string
}

export type StatusDomain =
  | 'lead'          // leads.status
  | 'classMode'     // applications.delivery, batches.class_type
  | 'payment'       // student_fees.status, applications.payment_status
  | 'feePayment'    // fee_payments.status
  | 'sms'           // sms_logs.status
  | 'importRow'     // lead_import_rows.outcome
  | 'admission'     // admissions.status
  | 'account'       // profiles.is_active

/*
 * Every value below was read from the production database rather than guessed.
 * tests/status.test.ts pins that list, so a value the system actually stores
 * cannot quietly fall through to the humanised fallback.
 */

const LEAD: Record<string, StatusDescriptor> = {
  new:            { label: 'New',            tone: 'accent',  hint: 'Not contacted yet' },
  contacted:      { label: 'Contacted',      tone: 'neutral', hint: 'Reached out, awaiting a reply' },
  interested:     { label: 'Interested',     tone: 'accent',  hint: 'Wants to know more' },
  follow_up:      { label: 'Follow up',      tone: 'warning', hint: 'Needs chasing' },
  next_session:   { label: 'Next session',   tone: 'neutral', hint: 'Joining a later intake' },
  ready_to_join:  { label: 'Ready to join',  tone: 'success', hint: 'Registered, awaiting a class' },
  registered:     { label: 'Registered',     tone: 'success', hint: 'Enrolled and paid' },
  not_interested: { label: 'Not interested', tone: 'muted',   hint: 'Declined' },
  conflicts:      { label: 'Conflicts',      tone: 'warning', hint: 'Clashes with another record' },
  zuku:           { label: 'Not qualified',  tone: 'danger',  hint: 'Does not meet the entry requirements' },
  // Held in the vocabulary because older rows and reports still use them.
  defiled:        { label: 'Defiled',        tone: 'muted' },
  deferred:       { label: 'Deferred',       tone: 'muted',   hint: 'Postponed to a later date' },
  done:           { label: 'Done',           tone: 'success' },
  lost:           { label: 'Lost',           tone: 'muted' },
}

const PAYMENT: Record<string, StatusDescriptor> = {
  paid:    { label: 'Paid',    tone: 'success', hint: 'Nothing outstanding' },
  partial: { label: 'Partial', tone: 'warning', hint: 'Some of the fee is still owed' },
  owing:   { label: 'Owing',   tone: 'danger',  hint: 'No payment received yet' },
  pending: { label: 'Pending', tone: 'warning', hint: 'Awaiting payment' },
}

const FEE_PAYMENT: Record<string, StatusDescriptor> = {
  pending:  { label: 'Awaiting verification', tone: 'warning', hint: 'Finance has not confirmed this yet' },
  verified: { label: 'Verified',              tone: 'success', hint: 'Confirmed and applied to the balance' },
  rejected: { label: 'Rejected',              tone: 'danger',  hint: 'Finance could not confirm this payment' },
}

/*
 * SMS delivery. The wording is chosen so a non-engineer can act on it, and so
 * "failed" never reads as "nothing happened" — a timed-out message may well
 * have been delivered, and saying otherwise would be a lie the delivery screen
 * exists to prevent.
 */
const SMS: Record<string, StatusDescriptor> = {
  queued:   { label: 'Waiting',   tone: 'neutral', hint: 'Queued; no attempt made yet' },
  sending:  { label: 'Sending',   tone: 'accent',  hint: 'An attempt is in flight' },
  retrying: { label: 'Retrying',  tone: 'warning', hint: 'An attempt failed; another is scheduled' },
  sent:     { label: 'Delivered', tone: 'success', hint: 'Handed to the network' },
  failed:   { label: 'Given up',  tone: 'danger',  hint: 'Every attempt failed' },
}

const IMPORT_ROW: Record<string, StatusDescriptor> = {
  assigned:   { label: 'Assigned',   tone: 'success', hint: 'Added and given to a marketer' },
  unassigned: { label: 'Unassigned', tone: 'warning', hint: 'Added, but nobody owns it yet' },
  duplicate:  { label: 'Duplicate',  tone: 'muted',   hint: 'Already in the system' },
  invalid:    { label: 'Invalid',    tone: 'danger',  hint: 'The row could not be read' },
  failed:     { label: 'Failed',     tone: 'danger',  hint: 'Could not be saved' },
}

const ADMISSION: Record<string, StatusDescriptor> = {
  admitted:  { label: 'Admitted',  tone: 'success' },
  pending:   { label: 'Pending',   tone: 'warning', hint: 'Awaiting a decision' },
  declined:  { label: 'Declined',  tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'muted' },
}

const ACCOUNT: Record<string, StatusDescriptor> = {
  active:   { label: 'Active',   tone: 'success' },
  inactive: { label: 'Inactive', tone: 'muted', hint: 'Cannot sign in' },
}

const TABLES: Record<Exclude<StatusDomain, 'classMode'>, Record<string, StatusDescriptor>> = {
  lead: LEAD,
  payment: PAYMENT,
  feePayment: FEE_PAYMENT,
  sms: SMS,
  importRow: IMPORT_ROW,
  admission: ADMISSION,
  account: ACCOUNT,
}

/**
 * Turn an unrecognised value into something readable.
 *
 * Never the raw enum, and never a guess at meaning: `next_intake` becomes
 * "Next intake" with a neutral tone, which is honest about the fact that the
 * system has no opinion on it.
 */
function humanise(value: string): StatusDescriptor {
  const label = value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/^./, c => c.toUpperCase())
  return { label: label || 'Unknown', tone: 'neutral' }
}

/**
 * Describe any status value in any domain.
 *
 * Class mode is delegated to lib/classMode.ts rather than duplicated here.
 * That module is the authority on what a mode IS — it already maps every
 * spelling the system has ever stored ('virtual', 'physical', 'onsite', …)
 * onto two canonical values — and this returns the one name the product uses
 * for each. Any screen showing a mode gets that name and no other.
 */
export function describeStatus(domain: StatusDomain, value: unknown): StatusDescriptor {
  if (domain === 'classMode') {
    const mode = parseClassMode(value)
    if (!mode) {
      // Unknown is shown as unknown. Defaulting to a mode here is exactly how
      // a student ends up holding the wrong admission letter.
      return { label: 'Mode not set', tone: 'warning', hint: 'No class mode recorded for this record' }
    }
    return mode === 'online'
      ? { label: classModeLabel(mode), tone: 'accent',  hint: 'Live over Zoom' }
      : { label: classModeLabel(mode), tone: 'neutral', hint: 'At the Cambridge campus' }
  }

  if (typeof value !== 'string' || !value.trim()) {
    return { label: 'Unknown', tone: 'muted' }
  }
  const key = value.trim().toLowerCase()
  return TABLES[domain][key] ?? humanise(value)
}

/**
 * Make any status value readable, without claiming to know what it means.
 *
 * For the domains this module does not model — a batch's state, a broadcast's,
 * a scheduled post's. Those screens were printing the raw column, so a person
 * read "not_interested" and "in_progress" in lower case next to properly
 * written labels. This is the floor: no snake_case ever reaches a reader, even
 * where the system has no opinion on the value.
 */
export function readableStatus(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Unknown'
  return humanise(value).label
}

/** Just the label, for places that cannot render a badge — a title, an export. */
export function statusLabel(domain: StatusDomain, value: unknown): string {
  return describeStatus(domain, value).label
}

/** Every value a domain knows, for building filter controls from one source. */
export function knownStatuses(domain: Exclude<StatusDomain, 'classMode'>): string[] {
  return Object.keys(TABLES[domain])
}

/**
 * Payment rules — pure domain logic, no configuration and no I/O.
 *
 * Kept dependency-free apart from the service-charge arithmetic, which is
 * itself importless, so this module can be unit tested directly.
 * lib/payments/verify.ts holds the one piece that genuinely needs a secret:
 * the signature check.
 */
import { splitGross, serviceChargeOn } from './serviceCharge.ts'

/** Constant-time hex comparison. A plain !== leaks the position of the first difference. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  // Compared without node:crypto so this module stays dependency-free; the
  // loop always runs to completion, so it does not short-circuit on the first
  // differing character.
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * The stable identity of a provider event.
 *
 * Paystack sends a numeric `data.id` per transaction. Falling back to the
 * reference is safe because a reference is unique per transaction too; what
 * matters is that repeat deliveries of the SAME event produce the SAME key.
 */
export function eventKey(event: PaystackEvent): string | null {
  const id = event?.data?.id
  const ref = event?.data?.reference
  if (id !== undefined && id !== null) return `paystack:${id}`
  if (ref) return `paystack:ref:${ref}`
  return null
}

export type PaystackEvent = {
  event?: string
  data?: {
    id?: number | string
    reference?: string
    amount?: number
    status?: string
    metadata?: Record<string, unknown> | null
    customer?: { email?: string } | null
  }
}

/** What the reference tells us this payment is for. */
export type PaymentPurpose =
  | { kind: 'application'; applicationId: string }
  | { kind: 'course_fee'; leadId: string }
  | { kind: 'unknown' }

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * Work out what a payment is for, from its metadata first and its reference
 * only as a fallback.
 *
 * Metadata is authoritative because it is set by us at initialisation. The
 * reference is parsed defensively: an application id is a UUID and therefore
 * contains dashes, so the reference cannot simply be split on '-'.
 */
export function classifyPayment(event: PaystackEvent): PaymentPurpose {
  const ref = String(event?.data?.reference || '')
  const meta = event?.data?.metadata || {}

  const metaApp = typeof meta.application_id === 'string' ? meta.application_id : null
  if (metaApp && UUID_RE.test(metaApp)) {
    return { kind: 'application', applicationId: metaApp.match(UUID_RE)![0] }
  }

  const metaLead = typeof meta.lead_id === 'string' ? meta.lead_id : null
  if (meta.purpose === 'course_fee' && metaLead && UUID_RE.test(metaLead)) {
    return { kind: 'course_fee', leadId: metaLead.match(UUID_RE)![0] }
  }

  if (ref.startsWith('CCE-APP-')) {
    const m = ref.slice('CCE-APP-'.length).match(UUID_RE)
    if (m) return { kind: 'application', applicationId: m[0] }
  }

  if (ref.startsWith('CCE-STU-')) {
    const m = ref.slice('CCE-STU-'.length).match(UUID_RE)
    if (m) return { kind: 'course_fee', leadId: m[0] }
  }

  if (metaLead && UUID_RE.test(metaLead)) {
    return { kind: 'course_fee', leadId: metaLead.match(UUID_RE)![0] }
  }

  return { kind: 'unknown' }
}

/** Paystack sends minor units (pesewas). Convert once, here. */
export function minorUnitsToGHS(amount: number | undefined): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null
  return Math.round(amount) / 100
}

/**
 * Is the amount received acceptable for what was expected?
 *
 * Overpayment is accepted and recorded at its true value — refusing a
 * registration because somebody paid too much would be absurd. Underpayment is
 * rejected, with a small tolerance for provider rounding.
 */
export function amountIsAcceptable(
  received: number,
  expected: number | null | undefined,
  toleranceGHS = 0.01
): { ok: boolean; reason?: string } {
  if (expected === null || expected === undefined) return { ok: true }
  if (!Number.isFinite(expected) || expected <= 0) return { ok: true }
  if (received + toleranceGHS < expected) {
    return { ok: false, reason: `Expected at least GHS ${expected.toFixed(2)}, received GHS ${received.toFixed(2)}` }
  }
  return { ok: true }
}

/**
 * What of a payment belongs to the fee, and what was the 1% charge.
 *
 * ── WHY THIS IS NOT JUST `amount` ──────────────────────────────────────────
 *
 * The payer is charged 1% on top of what they owe, so the figure Paystack
 * collects is a percent larger than the figure the fee ledger should be
 * credited. Crediting the gross clears a GHS 1,000 balance with GHS 1,010 and
 * leaves the student permanently in credit; charging the base to the gateway
 * would mean never collecting the charge at all.
 *
 * ── TRUSTING THE METADATA, BUT CHECKING IT ─────────────────────────────────
 *
 * base_amount and service_charge are written by this system when the payment
 * is initialised, and Paystack signs the whole event, so they cannot be
 * tampered with in flight. They can still be WRONG — a payment started by an
 * older build, or by hand in the Paystack dashboard.
 *
 * So they are checked, twice:
 *
 *   1. base + charge must equal the gross, to the pesewa — otherwise the
 *      metadata describes some other transaction
 *   2. the charge must be the charge that 1% of that base actually comes to
 *
 * The second check is the one that matters, and it is not obvious. Paystack's
 * inline popup is set up in the browser, so on that path the metadata is the
 * caller's to write — and `base_amount: 1010, service_charge: 0` on a payment
 * of GHS 1,010 passes the first check perfectly. It adds up. It is also a
 * student crediting themselves the service charge. Recomputing the charge
 * from the stated base is what refuses it.
 *
 * Either check failing discards the metadata in favour of deriving the split,
 * which is marked `derived` so the caller records a reconstruction as a
 * reconstruction.
 */
export function paymentSplit(
  event: PaystackEvent,
  grossGHS: number,
): { base: number; charge: number; derived: boolean } {
  const meta = event?.data?.metadata || {}
  const base = Number((meta as Record<string, unknown>).base_amount)
  const charge = Number((meta as Record<string, unknown>).service_charge)

  const stated = Number.isFinite(base) && base > 0 && Number.isFinite(charge) && charge >= 0
  if (stated) {
    const pesewa = (v: number) => Math.round(v * 100)
    const addsUp = Math.abs(pesewa(base + charge) - pesewa(grossGHS)) <= 1
    // The charge 1% of that base actually comes to, not the one claimed.
    const isOnePercent = Math.abs(pesewa(charge) - pesewa(serviceChargeOn(base))) <= 1
    if (addsUp && isOnePercent) {
      return { base: pesewa(base) / 100, charge: pesewa(charge) / 100, derived: false }
    }
  }

  return splitGross(grossGHS)
}

/**
 * What a payer should be charged for an expected amount — the figure to check
 * a registration payment against.
 *
 * Stated here so the webhook and the page that starts the payment cannot
 * disagree about whether the 1% is included.
 */
export function expectedGross(expectedBase: number | null | undefined): number | null {
  const n = Number(expectedBase)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round((n + serviceChargeOn(n)) * 100) / 100
}

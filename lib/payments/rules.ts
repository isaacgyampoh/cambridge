/**
 * Payment rules — pure domain logic, no configuration and no I/O.
 *
 * Kept importless so it can be unit tested directly. lib/payments/verify.ts
 * holds the one piece that genuinely needs a secret: the signature check.
 */

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

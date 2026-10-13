/**
 * Correcting what a student is charged.
 *
 * ── WHY THIS WAS MISSING, AND WHY IT SHOWED AS "OLD FEES" ──────────────────
 *
 * student_fees.total_fee is a SNAPSHOT. It is written once, when the student
 * registers, from the course fee of that day — see createFeeLedger in
 * lib/registration/complete.ts — and it deliberately does not follow a later
 * change to the course. A student who agreed GHS 4,950 should not silently
 * owe 5,950 because the price list moved.
 *
 * That is right, and it had no counterpart: NOTHING in the application could
 * change total_fee afterwards. Not an API route, not a screen. So a student
 * registered when the fee was 3,950 displayed 3,950 for ever — in Accounts,
 * in their portal, and in every reminder quoting their balance — and the only
 * way to correct one was to edit the database by hand.
 *
 * So: a deliberate correction, by a person, with a reason, recorded.
 *
 * ── WHAT IT MUST NEVER TOUCH ───────────────────────────────────────────────
 *
 * amount_paid. That is money the centre has actually received, and it belongs
 * to the payment records that produced it. Re-pricing changes what is OWED,
 * recomputes the balance from what was already paid, and leaves the receipts
 * alone. A correction that quietly moved amount_paid would make the books
 * disagree with the payments table.
 */

export type FeeState = {
  totalFee: number
  amountPaid: number
  balance: number
  /** 'owing' while anything is outstanding, 'paid' once it is not. */
  status: 'owing' | 'paid'
}

/** Money is compared to the pesewa, not to the floating-point zero. */
const TOLERANCE = 0.005

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * What the row becomes when the fee is corrected to `totalFee`.
 *
 * The balance is always derived — total minus paid — rather than adjusted by
 * the difference. Adjusting by a delta compounds every rounding error and
 * drifts from the payments that justify it; deriving cannot.
 */
export function repriceTo(totalFee: number, amountPaid: number): FeeState {
  const total = round2(totalFee)
  const paid = round2(amountPaid)
  const balance = round2(total - paid)
  return {
    totalFee: total,
    amountPaid: paid,
    balance,
    status: balance > TOLERANCE ? 'owing' : 'paid',
  }
}

export type RepriceRefusal = { ok: false; reason: string }
export type RepriceAccepted = { ok: true; totalFee: number; reason: string }

/**
 * Whether this correction may be made at all.
 *
 * A fee BELOW what the student has already paid is allowed: a discount
 * applied late, or a correction after an overpayment, both happen, and the
 * resulting credit is a real state the centre has to be able to represent.
 * What is refused is the nonsense — a negative price, something that is not a
 * number, and a correction with no reason attached, because a change to what
 * somebody owes with no explanation is indistinguishable from a mistake six
 * months later.
 */
export function validateReprice(input: {
  totalFee?: unknown
  reason?: unknown
  currentTotal?: number
}): RepriceAccepted | RepriceRefusal {
  const raw = typeof input.totalFee === 'string' ? input.totalFee.trim() : input.totalFee
  const total = Number(raw)

  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(total)) {
    return { ok: false, reason: 'Enter the corrected fee as a number.' }
  }
  if (total < 0) {
    return { ok: false, reason: 'A fee cannot be negative.' }
  }
  if (total > 1_000_000) {
    return { ok: false, reason: 'That fee looks wrong. Check the amount.' }
  }

  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (reason.length < 3) {
    return { ok: false, reason: 'Say why the fee is being corrected — it is kept on the record.' }
  }
  if (reason.length > 500) {
    return { ok: false, reason: 'Keep the reason under 500 characters.' }
  }

  if (input.currentTotal !== undefined && round2(input.currentTotal) === round2(total)) {
    return { ok: false, reason: 'That is already the fee on this record.' }
  }

  return { ok: true, totalFee: round2(total), reason }
}

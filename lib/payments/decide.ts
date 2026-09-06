/**
 * What a payment request is worth, and whether it may be treated as verified.
 *
 * ── WHY THIS IS A SEPARATE, PURE MODULE ────────────────────────────────────
 *
 * /api/fees/pay is public and unauthenticated — correctly, because a student
 * paying their own fees has no staff login. It used to take `method: "momo"`
 * from the request body and, on that word alone, mark the payment verified,
 * reduce the balance and send a receipt. It also took the AMOUNT from the
 * body, so a genuine one-cedi payment could be recorded as clearing the whole
 * fee.
 *
 * The fix put a Paystack check in front of it. This module exists so that the
 * rules that fix depends on are testable without a network, a database or a
 * provider — and so they stay tested. Every invariant below is asserted in
 * tests/paymentSecurity.test.ts, which is intended to remain green forever.
 */

/** What the caller asked for. Every field is untrusted. */
export type PaymentRequest = {
  method: string
  /** What the caller SAYS was paid. Never authoritative for mobile money. */
  amount?: unknown
  reference?: string | null
}

/** What Paystack said, server-side, using our secret key. */
export type ProviderVerification =
  | { ok: true; amount: number; reference: string }
  | { ok: false; reason: string }

export type PaymentDecision =
  | {
      outcome: 'verified'
      /** The amount to bank. For mobile money this is the PROVIDER's figure. */
      amount: number
      reference: string
    }
  | {
      /** Recorded, but not credited: finance confirms it by hand. */
      outcome: 'pending'
      amount: number
      reference: null
    }
  | { outcome: 'rejected'; reason: string }

/** Methods that must be confirmed with the provider before crediting. */
const PROVIDER_BACKED = ['momo']

/** Methods a human verifies afterwards. */
const MANUAL = ['bank', 'cash']

export function isKnownMethod(method: unknown): boolean {
  return typeof method === 'string'
    && (PROVIDER_BACKED.includes(method) || MANUAL.includes(method))
}

export function requiresProviderVerification(method: string): boolean {
  return PROVIDER_BACKED.includes(method)
}

/**
 * Decide the outcome of a payment request.
 *
 * `verification` is what the provider returned, or null when none was
 * performed. Passing null for a provider-backed method is itself a rejection:
 * the absence of a check is never treated as a pass, which is the exact shape
 * of the original defect.
 */
export function decidePayment(
  request: PaymentRequest,
  verification: ProviderVerification | null
): PaymentDecision {
  if (!isKnownMethod(request.method)) {
    return { outcome: 'rejected', reason: 'Unknown payment method' }
  }

  if (requiresProviderVerification(request.method)) {
    if (!request.reference) {
      return { outcome: 'rejected', reason: 'Missing payment reference' }
    }
    // No verification performed is a rejection, never a pass.
    if (!verification) {
      return { outcome: 'rejected', reason: 'Payment was not verified' }
    }
    if (!verification.ok) {
      return { outcome: 'rejected', reason: verification.reason }
    }
    // A provider that reports a nonsensical amount does not move a balance.
    if (!Number.isFinite(verification.amount) || verification.amount <= 0) {
      return { outcome: 'rejected', reason: 'The provider reported an invalid amount' }
    }
    /*
     * The provider's figure, never the caller's. This single line is the
     * difference between a student paying one cedi and a student clearing
     * their fees.
     */
    return {
      outcome: 'verified',
      amount: verification.amount,
      reference: verification.reference,
    }
  }

  // Bank transfer or cash: a CLAIM, not a payment. The amount is the caller's
  // because a human checks it before anything is credited, and it stays
  // pending until they do.
  const claimed = Number(request.amount)
  if (!Number.isFinite(claimed) || claimed <= 0) {
    return { outcome: 'rejected', reason: 'Enter a valid amount' }
  }
  return { outcome: 'pending', amount: claimed, reference: null }
}

/**
 * Whether a decision may reduce a student's balance.
 *
 * Only a verified decision moves money. Kept separate so the rule cannot be
 * re-derived differently at a call site.
 */
export function mayCreditBalance(decision: PaymentDecision): boolean {
  return decision.outcome === 'verified'
}

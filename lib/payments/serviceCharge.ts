/*
 * No imports. Money arithmetic is exactly the kind of rule that must be
 * exercised directly in a test, and the node test runner does not resolve the
 * '@/' alias — so this file stays loadable on its own.
 */

/**
 * THE 1% SERVICE CHARGE ON A CARD OR MOBILE-MONEY PAYMENT.
 *
 * ── WHO PAYS IT ────────────────────────────────────────────────────────────
 *
 * The payer. A student settling GHS 1,000 of fees is charged GHS 1,010 at
 * checkout: the centre receives the full GHS 1,000 towards the fee and the
 * GHS 10 covers the cost of taking the payment.
 *
 * That has one consequence the rest of the system has to respect: the amount
 * Paystack collects is NOT the amount owed on the fee ledger. Crediting the
 * gross would clear a GHS 1,000 balance with GHS 1,010 and leave the student
 * ten cedis in credit, every time, for ever. So the base and the charge are
 * carried separately from the moment the payment is initialised, and only the
 * base is credited.
 *
 * ── WHY IT IS A CONSTANT AND NOT A SETTING ─────────────────────────────────
 *
 * A rate read from the environment is a rate that can be wrong without
 * anybody noticing — and wrong here means over-charging every student who
 * pays. Changing what the centre charges is a deliberate act, so it is a
 * deliberate deploy.
 *
 * ── ALL ARITHMETIC IN PESEWAS ──────────────────────────────────────────────
 *
 * 1% of GHS 333.33 is GHS 3.3333, which has no banknote. Every calculation
 * here is done in whole pesewas and rounded once, at the point where the
 * fraction appears, because adding rounded figures and rounding again is how
 * a total stops matching its own lines.
 */

/** One percent. */
export const SERVICE_CHARGE_RATE = 0.01

/** How the charge is described wherever it is shown to a payer. */
export const SERVICE_CHARGE_LABEL = 'Service charge (1%)'

export type ChargeBreakdown = {
  /** What is owed, and what the ledger is credited. */
  base: number
  /** The 1%, rounded to the pesewa. */
  charge: number
  /** What the payer is actually charged. */
  gross: number
}

function pesewas(ghs: number): number {
  return Math.round(Number(ghs) * 100)
}

function ghs(p: number): number {
  return Math.round(p) / 100
}

/** Is this an amount we can charge at all? */
export function isPayableAmount(base: unknown): boolean {
  const n = Number(base)
  return Number.isFinite(n) && n > 0
}

/**
 * The charge on a given amount, rounded to the nearest pesewa.
 *
 * Nearest, not up: rounding a fraction of a pesewa in the centre's favour on
 * every payment is not worth defending, and nobody can pay half a pesewa
 * anyway. Zero or a nonsense amount carries no charge rather than throwing —
 * the callers all check payability separately, and a charge is never the
 * reason a payment cannot be made.
 */
export function serviceChargeOn(base: number): number {
  if (!isPayableAmount(base)) return 0
  return ghs(Math.round(pesewas(base) * SERVICE_CHARGE_RATE))
}

/** What the payer is charged for a given amount owed. */
export function grossWithCharge(base: number): number {
  if (!isPayableAmount(base)) return 0
  return ghs(pesewas(base) + pesewas(serviceChargeOn(base)))
}

/** Base, charge and total together — for a checkout screen or a receipt. */
export function chargeBreakdown(base: number): ChargeBreakdown {
  const charge = serviceChargeOn(base)
  return { base: isPayableAmount(base) ? ghs(pesewas(base)) : 0, charge, gross: grossWithCharge(base) }
}

/**
 * Work backwards from a total to the amount it was charged on.
 *
 * ── WHEN THIS IS USED, AND WHY IT IS A FALLBACK ────────────────────────────
 *
 * Every payment this system starts carries its own base and charge in the
 * Paystack metadata, which is what the webhook credits from: an exact figure,
 * signed by Paystack along with the rest of the event.
 *
 * This is for an event that has no such metadata — a payment taken before the
 * charge existed, or one started outside the portal. Inverting a rounded
 * figure cannot always land on the pesewa the base actually was, so the
 * result is explicitly marked as derived, and the caller records it as such
 * rather than presenting a reconstruction as a fact.
 */
export function splitGross(gross: number): { base: number; charge: number; derived: true } {
  if (!isPayableAmount(gross)) return { base: 0, charge: 0, derived: true }
  const total = pesewas(gross)
  const base = Math.round(total / (1 + SERVICE_CHARGE_RATE))
  return { base: ghs(base), charge: ghs(total - base), derived: true }
}

/**
 * The two figures a payer is told before they are sent to the gateway.
 *
 * Disclosure is not decoration. A total that appears only on the gateway's
 * own page, a percent larger than the figure the person agreed to, is the
 * kind of surprise that becomes a chargeback and a complaint to the bank.
 */
export function disclosureLines(base: number): string[] {
  const b = chargeBreakdown(base)
  return [
    `Amount: GHS ${b.base.toFixed(2)}`,
    `${SERVICE_CHARGE_LABEL}: GHS ${b.charge.toFixed(2)}`,
    `Total to pay: GHS ${b.gross.toFixed(2)}`,
  ]
}

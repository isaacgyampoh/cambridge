/**
 * NO FEE LEAVES THIS SYSTEM THAT THE SYSTEM DOES NOT HOLD.
 *
 * ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 *
 * The assistant already refuses to speak when it has nothing to speak from:
 * unreadable programmes, unreadable knowledge, or no facts at all each hand
 * the conversation to a person rather than let a model answer a question
 * about money from its own imagination.
 *
 * But once it DOES have facts, whatever it writes is sent. The system prompt
 * asks it to quote only the recorded fee, and a prompt is a request. A model
 * that has been told the PMP fee is GHS 3,950 will, often enough to matter,
 * write 4,000 — because it rounds, because it is summarising two programmes
 * at once, or because the lead asked a question whose obvious shape is a
 * number. Nothing downstream compared what it said to what is on file.
 *
 * A wrong fee is the single most expensive sentence this product can send. It
 * is quoted to a stranger on WhatsApp, in a marketer's name, and the centre
 * then either honours a price it never set or tells somebody the price went
 * up after they decided to enrol.
 *
 * ── WHY THIS IS DELIBERATELY NARROW ────────────────────────────────────────
 *
 * It only looks at amounts carrying a currency marker — GHS, GH₵, ₵, cedis.
 * A bare "3950" is left alone, because the assistant legitimately says things
 * like "9 to 5", "2026" and "6 weeks", and a guard that fires on those would
 * hand every second conversation to a person until somebody switched it off.
 *
 * Dates are deliberately NOT covered. "next month", "the Monday after" and
 * "early March" are all things a correct reply says, and there is no honest
 * way to check those against a cohort record without rejecting good answers.
 * Fees are exact, finite and enumerable; that is what makes them checkable.
 *
 * Pure and dependency-free, so the matching can be exercised directly.
 */

/** How an amount is compared: digits only, no thousands separators, no .00 */
function canonical(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  const digits = String(raw).replace(/[^\d.]/g, '')
  if (!digits) return null
  const n = Number(digits)
  if (!Number.isFinite(n)) return null
  // 3950, 3950.00 and 3,950 are one amount. Fractions of a cedi are not a
  // thing the centre prices in, so rounding here loses nothing real.
  return String(Math.round(n))
}

/*
 * A currency marker, then an amount — or an amount, then the word cedis.
 *
 * The marker is what makes this safe to act on. Without one there is no way
 * to tell a price from a year, a duration, or a time of day.
 */
const MONEY = new RegExp(
  [
    // GHS 3,950 · GH₵3950 · GHc 3,950.00 · ₵3950
    String.raw`(?:GH₵|GH¢|GHS|GHC|₵)\s*([\d][\d,]*(?:\.\d+)?)`,
    // 3,950 cedis
    String.raw`([\d][\d,]*(?:\.\d+)?)\s*(?:cedis|cedi)`,
  ].join('|'),
  'gi',
)

/** Every amount the text quotes as money, canonicalised. */
export function amountsIn(text: string): string[] {
  const out: string[] = []
  for (const m of String(text ?? '').matchAll(MONEY)) {
    const c = canonical(m[1] ?? m[2])
    if (c) out.push(c)
  }
  return out
}

type FeeBearing = {
  feeInPerson?: number | null
  feeOnline?: number | null
  registrationFee?: number | null
}

/**
 * Everything the assistant is allowed to say a price is.
 *
 * The programme records, plus any amount already written into the knowledge
 * base — an FAQ that quotes an exam fee or a resit charge is a fact the
 * centre put there on purpose, and repeating it is correct.
 */
export function allowedAmounts(
  programmes: FeeBearing[],
  knowledgeText = '',
): Set<string> {
  const out = new Set<string>()
  for (const p of programmes || []) {
    for (const fee of [p?.feeInPerson, p?.feeOnline, p?.registrationFee]) {
      const c = canonical(fee ?? null)
      if (c) out.add(c)
    }
  }
  for (const a of amountsIn(knowledgeText)) out.add(a)
  return out
}

/**
 * Amounts in the reply that nothing on file supports.
 *
 * Empty means the reply quotes only real figures — or quotes none at all,
 * which is the common case and costs one regex.
 */
export function unsupportedAmounts(reply: string, allowed: Set<string>): string[] {
  const seen = new Set<string>()
  for (const a of amountsIn(reply)) {
    if (!allowed.has(a)) seen.add(a)
  }
  return [...seen]
}

/**
 * Amounts the knowledge base asserts that no course fee backs.
 *
 * `allowedAmounts` unions the canonical programme fees with every amount found
 * in the knowledge text, so that the centre's own words about money are not
 * rejected. That union is also a hole: an FAQ row still saying a programme
 * costs GHS 3,950 after the fee became 5,950 makes 3,950 permissible, and the
 * assistant can quote the superseded figure to a student with the guard's
 * blessing. The guard is working as written — it is the text behind it that is
 * out of date, and nothing was reporting that.
 *
 * This does not filter anything. A legitimate amount lives here too: a
 * registration fee that no course row carries, an instalment, a discount. So
 * it reports for a person to read rather than deciding on its own, and the
 * caller presents it as something to check, never as a failure.
 */
export function unbackedAmounts(
  programmes: FeeBearing[],
  knowledgeText = '',
): string[] {
  const backed = new Set<string>()
  for (const p of programmes || []) {
    for (const fee of [p?.feeInPerson, p?.feeOnline, p?.registrationFee]) {
      const c = canonical(fee ?? null)
      if (c) backed.add(c)
    }
  }

  const out: string[] = []
  const seen = new Set<string>()
  for (const a of amountsIn(knowledgeText)) {
    if (backed.has(a) || seen.has(a)) continue
    seen.add(a)
    out.push(a)
  }
  return out
}

/**
 * WHICH WAY OF ATTENDING SOMEBODY IS ASKING ABOUT.
 *
 * ── WHY THIS IS ITS OWN DECISION ───────────────────────────────────────────
 *
 * The centre sells one programme two ways, at two prices — in person costs
 * more than online. Internally those are one course row with two fee columns
 * (course_fee and course_fee_online), and the staff and the leads both call
 * them "PMP Physical" and "PMP Virtual".
 *
 * No figure is written here on purpose. This comment used to name both
 * prices, and a comment in lib/admissions/letterPolicy.ts named two DIFFERENT
 * ones for the same programme — so the source asserted two contradictory
 * fees, neither of which the code reads. Prices live on the course record.
 *
 * The assistant is handed both figures, so it can answer either — but nothing
 * told it WHICH one was asked for. "How much is virtual PMP?" and "how much
 * is PMP?" arrived identically, and a model given two prices and no steer
 * will often answer with both, or with the first, or average the difference
 * into a sentence that is not quite either.
 *
 * Two thousand cedis of ambiguity, quoted on WhatsApp in a marketer's name.
 *
 * ── AND WHY IT IS A RULE RATHER THAN A PROMPT LINE ─────────────────────────
 *
 * "Work out which they mean" is a request. This is the reading of a word, it
 * is finite, and the centre's own vocabulary is not the model's: nobody
 * outside Ghana calls an online cohort "virtual" as consistently as the
 * people here do, and "physical" for in-person is close to unique to this
 * kind of institute. Detecting it here means the prompt can state the answer
 * rather than ask for one.
 *
 * Pure and dependency-free, so every phrasing can be exercised directly.
 */

export type DeliveryAsk = 'online' | 'in_person' | null

/*
 * How people actually write it, from the centre's own vocabulary outwards.
 *
 * Word boundaries throughout: "online" must not match inside a longer word,
 * and — the one that bites — "onsite" must not be read as "site".
 */
const ONLINE = /\b(virtual|virtually|online|on-line|remote|remotely|zoom|distance|from\s+home|at\s+home)\b/i

const IN_PERSON =
  /\b(physical|physically|in[-\s]?person|onsite|on[-\s]site|on[-\s]campus|campus|classroom|face[-\s]to[-\s]face|f2f|come\s+to\s+(the\s+)?(centre|center|office)|attend\s+in)\b/i

/**
 * The delivery mode this message is about, or null when it does not say.
 *
 * Null is the common case and the right default: most messages do not
 * mention a mode, and guessing one would be worse than the ambiguity it
 * replaced.
 *
 * A message naming BOTH — "is it physical or virtual?" — also returns null.
 * That is a question about the difference, not a request for one of them, and
 * the honest answer quotes both.
 */
export function askedDeliveryMode(text: string): DeliveryAsk {
  const s = String(text || '')
  const online = ONLINE.test(s)
  const inPerson = IN_PERSON.test(s)

  if (online && inPerson) return null
  if (online) return 'online'
  if (inPerson) return 'in_person'
  return null
}

/** What the centre calls it, for a sentence written to a lead. */
export function modeWord(mode: Exclude<DeliveryAsk, null>): string {
  return mode === 'online' ? 'online' : 'in person'
}

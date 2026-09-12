/**
 * Turning database rows into the lines the assistant is allowed to quote.
 *
 * Pure and dependency-free, because this is the single most important property
 * of the product: the assistant states a fee, a date or a venue ONLY from a
 * real record. Built inline inside the reply generator, that property could
 * not be checked without calling a language model. Here it is checked
 * directly.
 *
 * The rule these all share: a field the row does not hold does not appear.
 * Never filled in, never guessed, never rendered as "GHS null".
 */

export type KnowledgeCounts = { info: number; faqs: number; courses: number; batches: number }

export type KnowledgeBlocks = {
  /** The assembled text handed to the model. Empty when nothing is configured. */
  text: string
  /** What went into it, so a caller can tell an empty knowledge base from a failed read. */
  counts: KnowledgeCounts
}

/** A date a Ghanaian reader recognises: 3 March 2026. Null if it is not one. */
export function longDate(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * GHS 3,950 — the form the centre writes fees in.
 *
 * Returns null rather than a string for anything that is not a number, so a
 * bad value is left out of the message instead of being quoted as a price.
 */
export function ghs(amount: number | string | null | undefined): string | null {
  if (amount === null || amount === undefined || amount === '') return null
  const n = Number(amount)
  return Number.isFinite(n) ? `GHS ${n.toLocaleString('en-GH')}` : null
}

/*
 * courseLine() and batchLine() used to live here, along with CourseRow and
 * BatchRow. They rendered a programme from a row whose fee field was `price`
 * — a column nothing in this application writes — and they are gone with the
 * duplicate course read that used them.
 *
 * lib/chatbot/programmeRules.describeProgramme does that job now, from the
 * canonical course_fee, and states an absent fee as absent rather than
 * leaving it out.
 */

/**
 * Is there enough here to answer a question of fact at all?
 *
 * With nothing, the assistant must stop answering rather than fall back on
 * what a model happens to believe about a training centre in Ghana.
 */
export function hasFacts(k: KnowledgeBlocks): boolean {
  const { info, faqs, courses, batches } = k.counts
  return info + faqs + courses + batches > 0
}

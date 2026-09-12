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

export type CourseRow = {
  name: string
  code?: string | null
  price?: number | string | null
  duration?: string | null
}

export type BatchRow = {
  name: string
  class_type?: string | null
  status?: string | null
  start_date?: string | null
  schedule?: string | null
  venue?: string | null
  courses?: { name?: string | null } | null
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

/** One programme, as a line the assistant may quote verbatim. */
export function courseLine(c: CourseRow): string {
  const fee = ghs(c.price)
  return `- ${c.name}${fee ? ` — ${fee}` : ''}${c.duration ? `, ${c.duration}` : ''}`
}

/** One cohort. A start date appears only when the row actually has one. */
export function batchLine(b: BatchRow): string {
  const starts = longDate(b.start_date)
  const where = b.class_type === 'online'
    ? ' (online)'
    : b.venue ? ` (in person, ${b.venue})` : ''
  return `- ${b.courses?.name || b.name}${where}`
    + `${starts ? `, starts ${starts}` : ''}`
    + `${b.schedule ? `, ${b.schedule}` : ''}`
    + `${b.status === 'ongoing' ? ' — already running' : ''}`
}

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

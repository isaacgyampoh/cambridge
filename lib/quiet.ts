/**
 * Run side effects that must never fail the request.
 *
 * The pattern this replaces appeared in several places: a Promise.all over a
 * fan-out of notifications. Promise.all rejects on the FIRST rejection, so one
 * unreachable phone number threw away the outcome of every other send and
 * turned a committed piece of work into a 500. In /api/admissions that meant
 * the caller was told the admission had failed while the row sat in the
 * database — and the natural response, pressing the button again, created a
 * second admission for the same lead.
 *
 * Notifications are not the work. They are told about the work. If one fails,
 * the right outcome is a log line and a successful response, never a lost
 * delivery or a duplicated record.
 */

export type QuietOutcome = {
  total: number
  failed: number
  /** Why each failure failed, in order, for the caller to log or surface. */
  reasons: string[]
}

/** Never rejects. That is the whole point of it. */
export async function runQuietly(
  label: string,
  tasks: Array<Promise<unknown> | (() => Promise<unknown>)>,
  log: (...args: unknown[]) => void = console.error,
): Promise<QuietOutcome> {
  /*
   * A thunk is accepted as well as a promise so a caller can defer work that
   * would otherwise start executing while the list is being built. Calling it
   * here means a synchronous throw inside the thunk is caught too, rather than
   * escaping before allSettled ever sees it.
   */
  const started = tasks.map(t => {
    if (typeof t !== 'function') return t
    try { return t() } catch (e) { return Promise.reject(e) }
  })

  const settled = await Promise.allSettled(started)
  const reasons: string[] = []

  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      const why = outcome.reason instanceof Error
        ? outcome.reason.message
        : String(outcome.reason)
      reasons.push(why)
      log(label, 'side effect failed:', why)
    }
  }

  return { total: settled.length, failed: reasons.length, reasons }
}

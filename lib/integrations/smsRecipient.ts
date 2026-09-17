/*
 * Relative, with the extension: this module is unit tested directly and the
 * node test runner does not resolve the '@/' alias.
 */
import { canonicalGhanaMobile } from '../phone.ts'
/**
 * The one rule for what Arkesel is allowed to be given as a recipient.
 *
 * Pure and dependency-free on purpose: lib/integrations/sms.ts reaches for
 * server-only configuration, so nothing there can be exercised directly. This
 * is the part with the actual decision in it, and it is worth being able to
 * test the decision rather than trust it.
 *
 * ── WHY THE LENGTH CHECK IS THE POINT ──────────────────────────────────────
 *
 * The stripping rules alone will turn anything into something. `0246` — a
 * mistyped number, a spreadsheet cell that lost its digits — becomes
 * `233246`, which looks like a phone number and is not one. Posting it costs
 * a request, possibly a charge, and delivers nowhere; and because the queue
 * cannot tell that apart from a provider hiccup, it retries.
 *
 * A Ghanaian mobile is 233 and nine digits. Anything else is refused here,
 * before a request is made, so the failure is reported as what it is: a
 * number that was never going to work.
 */

/** Normalise a Ghanaian number to the 233XXXXXXXXX form Arkesel expects. */
export function normaliseRecipient(num: string): string | null {
  return canonicalGhanaMobile(num)
}

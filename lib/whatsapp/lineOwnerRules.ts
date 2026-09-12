import { phoneVariants } from '../leads/importValidation.ts'

/**
 * WHOSE LINE DID THIS ARRIVE ON?
 *
 * ── WHY THIS DECISION EXISTS ───────────────────────────────────────────────
 *
 * Each marketer connects their own WhatsApp number to the system, so an
 * inbound message names two people: the prospect who sent it, and the
 * marketer they chose to send it to. Only the sender was ever read.
 *
 * A stranger who messaged Ruth's number was therefore handed to the weighted
 * lottery like any anonymous web enquiry, and could land on any marketer at
 * all — who then answered, in their own voice, from their own line. The
 * prospect messaged Ruth and a stranger replied. Ruth never saw the lead she
 * had earned, and the lottery's fairness was being applied to a lead that was
 * never anonymous in the first place.
 *
 * Pure and dependency-free so the matching can be exercised directly: the
 * server half does the reading, this does the deciding.
 */

export type MarketerLine = {
  /** profiles.id */
  id: string
  /** profiles.wasender_phone — the number they connected. */
  line: string | null
  /** Whether the connection is usable. */
  active?: boolean
}

/**
 * The marketer whose connected line received this message.
 *
 * Returns null when the provider did not say which line it was, when no
 * marketer has claimed that number, or — importantly — when more than one
 * has. An ambiguous answer is not an answer: two profiles carrying the same
 * number means somebody mistyped one of them, and quietly picking the first
 * would credit a marketer for a lead that may well be their colleague's.
 * Null falls through to the ordinary assignment rules, which is the safe
 * direction to be wrong in.
 */
export function ownerOfLine(receivedOn: string | null, lines: MarketerLine[]): string | null {
  if (!receivedOn) return null

  const wanted = new Set(phoneVariants(receivedOn))
  if (!wanted.size) return null

  const matches = lines.filter(m => {
    if (m.active === false) return false
    if (!m.line) return false
    return phoneVariants(m.line).some(v => wanted.has(v))
  })

  // Exactly one, or nobody. See above on why a tie is not broken here.
  return matches.length === 1 ? matches[0].id : null
}

/**
 * Is this message arriving on a line we know about at all?
 *
 * Distinguishes "the provider told us nothing" from "the provider named a
 * number nobody has connected" — the second is worth recording, because it
 * usually means a marketer's profile still holds the number they had before
 * they changed it, and every lead from that line is being misfiled.
 */
export function isKnownLine(receivedOn: string | null, lines: MarketerLine[]): boolean {
  if (!receivedOn) return false
  const wanted = new Set(phoneVariants(receivedOn))
  return lines.some(m => m.line && phoneVariants(m.line).some(v => wanted.has(v)))
}

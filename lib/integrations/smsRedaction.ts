/*
 * One relative import, to lib/auth/pinPolicy.ts, which is itself import-free —
 * so this module stays loadable by the node test runner, which does not
 * resolve the '@/' alias.
 *
 * The lengths come from there rather than being written out here. A PIN is
 * four digits and a code is six TODAY; a file that restates that is a file
 * that keeps masking four digits of a five-digit PIN after somebody changes
 * it, leaving the rest on screen. tests/pinPolicy.test.ts refuses any source
 * file that declares its own.
 */
import { PIN_LENGTH, OTP_LENGTH } from '../auth/pinPolicy.ts'

/**
 * TAKE THE CREDENTIALS OUT OF A STORED MESSAGE ON THE WAY TO THE SCREEN.
 *
 * ── WHY A READ-SIDE RULE AND NOT JUST A MIGRATION ──────────────────────────
 *
 * Messages carrying a credential are no longer stored: lib/integrations/sms.ts
 * logs a label instead. That fixed everything sent from now on and nothing
 * sent before it — and production holds 34 onboarding messages, each with a
 * named member of staff's initial PIN in it, in a log the SMS delivery screen
 * shows to anyone holding `broadcast` or `settings`.
 *
 * Migration 0027 rewrites those rows. But a migration is a thing somebody has
 * to run, and until it runs the PINs are readable — so the exposure is closed
 * here, where the rows are served, rather than waiting. Afterwards this
 * becomes a second line of defence that costs nothing, and it also covers any
 * row written by a path that forgets to mark its message.
 *
 * ── WHY IT MASKS THE DIGITS AND NOT THE MESSAGE ────────────────────────────
 *
 * The screen exists to answer "why did this person not get their text?".
 * Blanking the body takes the answer away with the credential. The words stay
 * and only the secret goes, so the row still says which message it was.
 *
 * ── AND WHY IT IS ANCHORED TO WORDS, NOT TO DIGITS ─────────────────────────
 *
 * Masking every run of four digits would redact "GHS 5950", a date, a class
 * time and a receipt number — most of what the log is for. Each pattern below
 * is anchored to the word that makes those digits a credential.
 */

/** What replaces a credential. Fixed width: the length is a hint too. */
const MASK = '••••'

/** A run of digits long enough to be a PIN or a code, and no longer. */
const DIGITS = `\\d{${Math.min(PIN_LENGTH, OTP_LENGTH)},${Math.max(PIN_LENGTH, OTP_LENGTH)}}`

/**
 * The words that turn a run of digits into a secret.
 *
 * Each is the phrasing one of the messages actually uses. Anchoring to them
 * is what keeps "GHS 5950", a class time and a receipt number out of it.
 */
const LEAD_INS: readonly string[] = [
  'PIN\\s*:?\\s*',        // "PIN: 4821", "PIN 4821", "pin:4821"
  'reset to\\s+',         // "your PIN has been reset to 4821"
  'code is\\s+',           // "your sign-in code is 481902"
  'code\\s*:?\\s+',       // "verification code 481902"
]

const RULES: readonly RegExp[] = LEAD_INS.map(
  lead => new RegExp(`\\b(${lead})(${DIGITS})\\b`, 'gi'),
)

/**
 * Mask any credential in a stored message.
 *
 * Returns the message unchanged when there is nothing to mask, so an ordinary
 * class reminder is served exactly as it was sent.
 */
export function redactStoredMessage(message: string | null | undefined): string | null {
  if (message === null || message === undefined) return message ?? null
  let out = String(message)
  for (const rule of RULES) out = out.replace(rule, (_match, lead: string) => `${lead}${MASK}`)
  return out
}

/** Did this message carry something that had to be masked? For the screen. */
export function carriedCredential(message: string | null | undefined): boolean {
  if (!message) return false
  return redactStoredMessage(message) !== String(message)
}

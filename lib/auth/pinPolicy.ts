/**
 * THE PIN POLICY. One source of truth.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * A PIN in this product is EXACTLY FOUR DIGITS. Not four to eight, not six,
 * not variable.
 *
 * That rule was previously restated in eight places with three different
 * answers — `/^\d{4,8}$/` in verify-pin and change-pin, `/^\d{4,6}$/` in the
 * staff endpoints, and a login form whose boxes grew to eight. The account
 * recovery route then issued an eight-digit PIN that the four-box form could
 * not accept, so recovery had never worked. Every one of those was a local
 * decision that looked reasonable on its own.
 *
 * Nothing may hardcode a PIN length again. Import from here.
 *
 * ── PIN IS NOT OTP ─────────────────────────────────────────────────────────
 *
 * These are separate concepts and separate lengths, and conflating them is how
 * the four-versus-eight confusion started. A PIN is a durable credential the
 * person chooses. An OTP is a short-lived code the system generates and emails.
 * Both are declared here so the distinction is visible in one place.
 */

/** A PIN is exactly this many digits. Everywhere. */
export const PIN_LENGTH = 4

/** The emailed sign-in code. A different thing from a PIN. */
export const OTP_LENGTH = 6

export const PIN_PATTERN = new RegExp(`^\\d{${PIN_LENGTH}}$`)
export const OTP_PATTERN = new RegExp(`^\\d{${OTP_LENGTH}}$`)

/** Shown wherever a PIN is asked for, so the wording cannot drift either. */
export const PIN_DESCRIPTION = `${PIN_LENGTH}-digit PIN`

export function isValidPin(value: unknown): value is string {
  return typeof value === 'string' && PIN_PATTERN.test(value)
}

export function isValidOtp(value: unknown): value is string {
  return typeof value === 'string' && OTP_PATTERN.test(value)
}

/**
 * PINs that get guessed first.
 *
 * With only ten thousand possibilities, refusing the handful that people
 * actually pick is a meaningful share of the risk. Kept here rather than in
 * change-pin so that every path which SETS a PIN — the user changing their
 * own, an administrator resetting a colleague's, the recovery flow — applies
 * the same rule.
 */
const WEAK = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '0123', '1230', '2580', '1212', '1122', '6969',
])

/**
 * Why this PIN may not be used, or null if it is acceptable.
 *
 * Returns a sentence intended for the person choosing it.
 */
export function pinRejectionReason(pin: string): string | null {
  if (!isValidPin(pin)) return `Your PIN must be exactly ${PIN_LENGTH} digits.`
  if (WEAK.has(pin)) return 'That PIN is too easy to guess. Please choose another.'
  if (/^(\d)\1+$/.test(pin)) return 'A PIN cannot be the same digit repeated. Please choose another.'

  const digits = pin.split('').map(Number)
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1)
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1)
  if (ascending || descending) return 'A PIN cannot be consecutive digits. Please choose another.'

  return null
}

/**
 * A PIN the system generates — for a staff reset, or account recovery.
 *
 * Uniformly random over the whole space, then re-drawn if it lands on
 * something the policy would refuse, so a generated PIN is never one a person
 * would be told to change. `crypto.randomInt` rather than Math.random, because
 * this is a credential.
 */
export function generatePin(randomInt: (min: number, max: number) => number): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let pin = ''
    for (let i = 0; i < PIN_LENGTH; i++) pin += randomInt(0, 10)
    if (!pinRejectionReason(pin)) return pin
  }
  // Unreachable in practice: the refused set is a few dozen of ten thousand.
  throw new Error('Could not generate an acceptable PIN')
}

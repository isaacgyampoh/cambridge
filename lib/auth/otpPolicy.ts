/**
 * HOW LONG AN EMAILED SIGN-IN CODE IS GOOD FOR. One source of truth.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * `const OTP_MINUTES = 10` was written out three times — in
 * lib/auth/recovery.ts, in app/api/auth/verify-pin/route.ts and in
 * app/api/auth/resend-otp/route.ts. Three copies of one decision, each free
 * to drift, and each one the kind of line somebody changes locally to fix the
 * complaint in front of them.
 *
 * The lifetime is now stated once. Nothing may hardcode it again.
 *
 * ── WHY SIX HOURS ──────────────────────────────────────────────────────────
 *
 * The owner asked for six. The practical reason is that staff here read a
 * work mailbox on a shared or intermittently-connected device: a code that
 * dies in ten minutes means requesting another, and another, which is both
 * the most common support call and — because each request sends a message —
 * the most expensive one.
 *
 * ── WHY A LONGER WINDOW IS NOT A WEAKER ONE ────────────────────────────────
 *
 * The window is not what stops a code being guessed. What stops it is that
 * the code is stored hashed, that attempts are counted and the code is
 * destroyed when they run out, that it is single use, and that requesting and
 * submitting are both rate limited per IP. All of that is unchanged. A longer
 * validity gives an attacker more wall-clock time against a counter that does
 * not reset — it does not give them more attempts.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 *
 * This is the EMAILED CODE only. It deliberately does not touch:
 *
 *   - RESET_TOKEN_MINUTES, the short-lived token that authorises setting a
 *     new PIN once a code has already been proved. That is a bearer
 *     credential and stays at fifteen minutes.
 *   - the sign-in session cookie
 *   - the SETUP_SECRET provisioning window
 *   - the student magic link
 *
 * Those are different mechanisms with different threat models, and widening
 * them because this one widened would be exactly the mistake.
 */

/** The validity period of an emailed one-time code, in minutes. */
export const OTP_MINUTES = 6 * 60

/** The same, in seconds — what the screens count down from. */
export const OTP_SECONDS = OTP_MINUTES * 60

/** Said in words, for a message a person reads. */
export function otpValidityPhrase(): string {
  const hours = OTP_MINUTES / 60
  if (Number.isInteger(hours)) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${OTP_MINUTES} minutes`
}

/*
 * Import-free so the rule can be exercised directly in a test.
 */

/**
 * WHAT A NEW APPLICANT PAYS TO REGISTER.
 *
 * ── WHY THIS IS NOT IN THE BROWSER ANY MORE ────────────────────────────────
 *
 * The apply page sent `amount: 200` in the body of the request that starts
 * the payment, and the server initialised Paystack with whatever it was
 * given. Anybody who could open the developer console could register for a
 * cedi. The webhook's amount check was the only thing standing behind it, and
 * that check passes anything when the course has no registration fee
 * recorded — which is the common case.
 *
 * The figure is settled on the server now, from the course record, and the
 * browser is not asked.
 *
 * ── THE FALLBACK, AND WHY IT IS NAMED ──────────────────────────────────────
 *
 * Courses that have no registration_fee set still have to be registerable, so
 * there is a fallback — and it is deliberately the same GHS 200 the apply page
 * has always charged, so this change does not quietly reprice anything.
 *
 * It is a named constant in one file rather than a literal in a React
 * component, because that is the difference between a default somebody can
 * find and a number nobody knew was there.
 */
export const REGISTRATION_FEE_FALLBACK = 200

export type CourseRegistrationFee = {
  registration_fee?: number | string | null
}

/**
 * The registration fee for a course, and whether it came from the record.
 *
 * `fromCourse: false` means the fallback was used, which the caller logs: a
 * course priced by default rather than by decision is worth noticing on the
 * Courses screen before a hundred people have paid it.
 */
export function registrationBase(
  course: CourseRegistrationFee | null | undefined,
): { amount: number; fromCourse: boolean } {
  const recorded = Number(course?.registration_fee)
  if (Number.isFinite(recorded) && recorded > 0) {
    return { amount: Math.round(recorded * 100) / 100, fromCourse: true }
  }
  return { amount: REGISTRATION_FEE_FALLBACK, fromCourse: false }
}

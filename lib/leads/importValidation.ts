/**
 * Import row validation — pure, no data access, so it can be tested directly.
 *
 * These rules decide whether a row from a spreadsheet becomes a lead. Getting
 * them wrong is expensive in both directions: too strict and real people are
 * silently dropped from a paid list, too loose and the database fills with
 * rows nobody can ring.
 */

/** leads.source is a Postgres enum. Anything else fails the insert outright. */
export const LEAD_SOURCES = [
  'facebook', 'google', 'linkedin', 'website', 'referral', 'manual', 'walk_in',
] as const

export type LeadSource = typeof LEAD_SOURCES[number]

/**
 * Normalise a Ghanaian mobile number to its storage form, 233XXXXXXXXX.
 *
 * Spreadsheets carry numbers in every shape a person might type: with the
 * country code, without it, with a leading zero, with spaces, dashes or
 * brackets, and quite often as a number that Excel has helpfully stripped the
 * leading zero from. All of those are the same phone.
 *
 * Returns null when it is not a Ghanaian mobile, rather than storing something
 * unreachable — a lead nobody can call is worse than a row rejected with a
 * reason the operator can act on.
 */
export function canonicalPhone(raw?: string | null): string | null {
  // The international dialling prefix, before anything else. Without this
  // "00233201234567" keeps its zeros, fails the nine-digit test and is
  // refused — or, in the intake path that kept its own copy of this rule, was
  // turned into 2330233201234567 and stored as somebody's phone number.
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^00/, '')
  if (!digits) return null

  const local = digits.replace(/^233/, '').replace(/^0/, '')
  // Ghanaian mobile numbers are nine digits after the country code.
  return local.length === 9 ? `233${local}` : null
}

/**
 * Every spelling of a number that might already be stored, for deduplication.
 *
 * Existing rows were written by several different code paths over time, so the
 * same person may be on file as 0201234567, 233201234567 or 201234567. A
 * dedupe that checks only one of those creates a duplicate.
 */
export function phoneVariants(raw?: string | null): string[] {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^00/, '')
  if (!digits) return []
  const local = digits.replace(/^233/, '').replace(/^0/, '')
  if (!local) return []
  return Array.from(new Set([digits, local, `0${local}`, `233${local}`]))
}

/** A UTM or spreadsheet value is only used when it is genuinely an enum label. */
export function resolveSource(raw?: string | null): LeadSource {
  const candidate = String(raw ?? '').trim().toLowerCase()
  return (LEAD_SOURCES as readonly string[]).includes(candidate)
    ? candidate as LeadSource
    : 'manual'
}

export type RowValidation =
  | { ok: true; name: string; phone: string | null; email: string | null }
  | { ok: false; reason: string }

/**
 * Decide whether a row can become a lead.
 *
 * A name plus at least one way to reach them. The reason is written for the
 * operator reading the failure list, not for a log: "Phone 024123 is not a
 * valid Ghanaian mobile number" tells them what to fix; "invalid" does not.
 */
export function validateRow(row: {
  full_name?: string | null
  phone?: string | null
  email?: string | null
}): RowValidation {
  const name = row.full_name?.trim()
  if (!name) return { ok: false, reason: 'No name' }

  const phone = canonicalPhone(row.phone)
  const email = row.email?.trim().toLowerCase() || null

  if (!phone && !email) {
    return {
      ok: false,
      reason: row.phone
        ? `Phone "${row.phone}" is not a valid Ghanaian mobile number`
        : 'No phone or email',
    }
  }

  return { ok: true, name, phone, email }
}

/**
 * Does an import's accounting add up?
 *
 * The reported totals used to be summed in the browser, which counted a whole
 * batch as failed whenever a request died — so "20 failed" could sit next to
 * six leads that had genuinely been created. Every row must land in exactly
 * one bucket, and this is the invariant that says so.
 */
export function accountingBalances(t: {
  totalReceived: number
  valid: number
  invalid: number
  duplicates: number
  assigned: number
  unassigned: number
  failed: number
}): boolean {
  const everyRowClassified = t.valid + t.invalid === t.totalReceived
  const everyValidRowResolved =
    t.assigned + t.unassigned + t.duplicates + t.failed === t.valid
  return everyRowClassified && everyValidRowResolved
}

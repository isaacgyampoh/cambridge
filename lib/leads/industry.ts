/*
 * Import-free, so every rule here is unit tested directly — the node test
 * runner does not resolve the '@/' alias.
 */

/**
 * WHAT INDUSTRY A LEAD IS IN.
 *
 * ── WHY IT IS A LIST AND NOT A TEXT BOX ────────────────────────────────────
 *
 * The centre sells professional certifications, and which certification suits
 * somebody is largely a question of what they do: PMP sells into
 * construction, oil and gas, and the public sector; the HR qualifications
 * sell into banking, telecoms and large manufacturers. Knowing the mix of a
 * purchased list is the difference between a targeted follow-up and a
 * hundred identical calls.
 *
 * That only works if the answers can be counted. Typed free-hand, "Oil & Gas"
 * arrives as "oil and gas", "O&G", "Oil/Gas" and "petroleum" — five
 * industries on a chart where there is one. So this is a fixed list of codes
 * with a parser in front of it, and a spreadsheet's own wording is mapped
 * onto the list rather than stored as it was written.
 *
 * ── AND WHY 'other' EXISTS ─────────────────────────────────────────────────
 *
 * A list that cannot say "none of these" gets filled in with the nearest
 * wrong answer. `other` is an honest answer; null means nobody has said.
 */

export type Industry = {
  code: string
  label: string
  /** Words that mean this industry in a spreadsheet, lowercase. */
  aliases: readonly string[]
}

export const INDUSTRIES: readonly Industry[] = [
  { code: 'oil_gas', label: 'Oil & Gas', aliases: ['oil', 'gas', 'petroleum', 'o&g', 'upstream', 'downstream'] },
  { code: 'mining', label: 'Mining', aliases: ['mining', 'mine', 'gold', 'quarry', 'minerals'] },
  { code: 'banking_finance', label: 'Banking & Finance', aliases: ['bank', 'banking', 'finance', 'financial', 'microfinance', 'investment', 'accounting', 'audit'] },
  { code: 'insurance', label: 'Insurance', aliases: ['insurance', 'insurer', 'assurance'] },
  { code: 'telecoms', label: 'Telecoms', aliases: ['telecom', 'telecoms', 'telecommunication', 'mobile network', 'isp'] },
  { code: 'construction', label: 'Construction', aliases: ['construction', 'building', 'contractor', 'civil works', 'infrastructure'] },
  { code: 'engineering', label: 'Engineering', aliases: ['engineering', 'engineer'] },
  { code: 'health', label: 'Health', aliases: ['health', 'hospital', 'clinic', 'medical', 'pharma', 'pharmaceutical', 'nursing'] },
  { code: 'education', label: 'Education', aliases: ['education', 'school', 'university', 'college', 'training', 'academic', 'teaching'] },
  { code: 'government', label: 'Government & Public Sector', aliases: ['government', 'public sector', 'ministry', 'municipal', 'district assembly', 'civil service', 'parastatal', 'authority'] },
  { code: 'ngo', label: 'NGO & Development', aliases: ['ngo', 'non-governmental', 'nonprofit', 'non-profit', 'development', 'donor', 'charity', 'humanitarian'] },
  { code: 'it_software', label: 'IT & Software', aliases: ['it', 'ict', 'software', 'technology', 'tech', 'data', 'computing', 'fintech'] },
  { code: 'manufacturing', label: 'Manufacturing', aliases: ['manufacturing', 'factory', 'production', 'industrial', 'processing'] },
  { code: 'transport_logistics', label: 'Transport & Logistics', aliases: ['transport', 'logistics', 'shipping', 'freight', 'haulage', 'port', 'aviation', 'airline'] },
  { code: 'energy_utilities', label: 'Energy & Utilities', aliases: ['energy', 'power', 'electricity', 'utility', 'utilities', 'water', 'solar'] },
  { code: 'agriculture', label: 'Agriculture', aliases: ['agric', 'agriculture', 'agro', 'farming', 'farm', 'cocoa', 'fishery', 'agribusiness'] },
  { code: 'hospitality_tourism', label: 'Hospitality & Tourism', aliases: ['hospitality', 'hotel', 'tourism', 'travel', 'restaurant', 'catering'] },
  { code: 'retail_trade', label: 'Retail & Trade', aliases: ['retail', 'trade', 'trading', 'wholesale', 'commerce', 'shop', 'supermarket'] },
  { code: 'legal', label: 'Legal', aliases: ['legal', 'law', 'chambers', 'advocate', 'solicitor'] },
  { code: 'media', label: 'Media & Communications', aliases: ['media', 'communication', 'communications', 'advertising', 'marketing agency', 'broadcast', 'publishing', 'pr'] },
  { code: 'real_estate', label: 'Real Estate', aliases: ['real estate', 'property', 'estate', 'facilities'] },
  { code: 'consulting', label: 'Consulting', aliases: ['consulting', 'consultancy', 'consultant', 'advisory'] },
  { code: 'student', label: 'Student / Unemployed', aliases: ['student', 'graduate', 'unemployed', 'nss', 'national service', 'job seeker', 'jobseeker'] },
  { code: 'other', label: 'Other', aliases: ['other', 'others', 'misc', 'n/a'] },
]

export const INDUSTRY_CODES: readonly string[] = INDUSTRIES.map(i => i.code)

/**
 * Turn whatever a spreadsheet says into one of the codes above.
 *
 * ── MATCHED IN A DELIBERATE ORDER ──────────────────────────────────────────
 *
 * An exact code or label first, so "oil_gas" and "Oil & Gas" are settled
 * without guessing. Only then the aliases, as whole words.
 *
 * Whole words matter more than it looks. 'it' is an alias of IT & Software,
 * and a substring match would read "Hospitality" and "Unit Trust" as IT —
 * which is not a rare edge case, it is most of a list. The two-letter
 * aliases are exactly why this cannot be a simple `includes`.
 *
 * Returns null rather than a guess when nothing matches. Null means nobody
 * has said, which the caller can fill in from the batch's own answer or
 * leave alone; `other` would be recording an answer nobody gave.
 */
export function parseIndustry(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return null

  const squashed = value.replace(/[\s/\\-]+/g, '_')
  const exactCode = INDUSTRIES.find(i => i.code === squashed)
  if (exactCode) return exactCode.code

  const normalised = value.replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
  const exactLabel = INDUSTRIES.find(
    i => i.label.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim() === normalised,
  )
  if (exactLabel) return exactLabel.code

  /*
   * Whole-word alias matching, longest alias first so "real estate" is not
   * decided by "estate" and "non-profit" is not decided by "profit".
   */
  const words = new Set(normalised.split(' ').filter(Boolean))
  const byLength = INDUSTRIES.flatMap(i => i.aliases.map(a => ({ code: i.code, alias: a })))
    .sort((a, b) => b.alias.length - a.alias.length)

  for (const { code, alias } of byLength) {
    const parts = alias.replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    if (parts.length === 1) {
      if (words.has(parts[0])) return code
    } else if (normalised.includes(parts.join(' '))) {
      return code
    }
  }

  return null
}

/** The label for a stored code. Falls back to the code so nothing shows blank. */
export function industryLabel(code: string | null | undefined): string {
  if (!code) return '—'
  return INDUSTRIES.find(i => i.code === code)?.label || code
}

/** Is this a code we recognise? Used before anything is written. */
export function isIndustryCode(code: unknown): boolean {
  return typeof code === 'string' && INDUSTRY_CODES.includes(code)
}

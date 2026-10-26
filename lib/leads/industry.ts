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
 * ── AND WHY THERE IS NO 'OTHER' ────────────────────────────────────────────
 *
 * The sixteen are the centre's own list. Wording that matches none of them is
 * recorded as nothing at all — which is the honest answer, and already tells
 * "nobody has said" apart from every real industry. An "Other" bucket would
 * be this file adding a seventeenth entry to somebody else's list.
 */

export type Industry = {
  code: string
  label: string
  /** Words that mean this industry in a spreadsheet, lowercase. */
  aliases: readonly string[]
}

/**
 * THE SIXTEEN, AS WRITTEN DOWN BY THE CENTRE.
 *
 * This list is not ours to extend on a hunch. It was given as a numbered list
 * and is reproduced in that order, with the labels as they were written —
 * "Energy, Oil and Gas" is one industry here and not three, and "Telecom and
 * IT" is one and not two, because that is how the centre sells to them.
 *
 * The aliases are the only part this file decides. They exist so a purchased
 * spreadsheet saying "GCB Bank", "Ministry of Trade" or "O&G" lands in the
 * right one of the sixteen instead of being typed in again by hand.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *
 * There is no "Other". A seventeenth entry would be this file adding to a
 * list somebody else drew up — and it is not needed: wording that matches
 * none of the sixteen is recorded as NOTHING, which is the honest answer and
 * already distinguishable from every real one.
 *
 * Insurance, hospitality, retail and real estate are not on the list either.
 * Where they clearly belong to one of the sixteen they are aliases of it
 * (insurance → Financial Services); where they do not, they are left to fall
 * through to "not stated" rather than being filed under the nearest wrong
 * answer.
 */
export const INDUSTRIES: readonly Industry[] = [
  { code: 'agribusiness', label: 'Agribusiness', aliases: ['agribusiness', 'agric', 'agriculture', 'agro', 'farming', 'farm', 'cocoa', 'poultry', 'fishery', 'plantation'] },
  { code: 'construction_engineering', label: 'Construction/Engineering', aliases: ['construction', 'engineering', 'engineer', 'building', 'contractor', 'civil works', 'infrastructure', 'quantity surveying', 'architecture'] },
  { code: 'education_training', label: 'Education and Training', aliases: ['education', 'training', 'school', 'university', 'college', 'polytechnic', 'academic', 'teaching', 'institute'] },
  { code: 'energy_oil_gas', label: 'Energy, Oil and Gas', aliases: ['oil', 'gas', 'petroleum', 'o and g', 'upstream', 'downstream', 'energy', 'power', 'electricity', 'solar', 'utility', 'utilities'] },
  { code: 'entertainment', label: 'Entertainment', aliases: ['entertainment', 'media', 'music', 'film production', 'film', 'events', 'broadcast', 'advertising', 'creative arts', 'publishing'] },
  { code: 'financial_services', label: 'Financial Services', aliases: ['financial services', 'finance', 'financial', 'bank', 'banking', 'microfinance', 'savings and loans', 'investment', 'insurance', 'assurance', 'accounting', 'audit', 'fintech'] },
  { code: 'health_care', label: 'Health Care', aliases: ['health care', 'healthcare', 'health', 'hospital', 'clinic', 'medical', 'pharmaceutical', 'pharma', 'nursing', 'laboratory'] },
  { code: 'human_resources', label: 'Human Resources', aliases: ['human resources', 'hr', 'recruitment', 'talent', 'people and culture', 'staffing'] },
  { code: 'law_legal', label: 'Law and Legal Services', aliases: ['law', 'legal', 'chambers', 'advocate', 'solicitor', 'attorney', 'notary'] },
  { code: 'manufacturing', label: 'Manufacturing', aliases: ['manufacturing', 'factory', 'production', 'industrial', 'processing', 'fmcg', 'brewery'] },
  { code: 'mining', label: 'Mining', aliases: ['mining', 'mine', 'gold', 'bauxite', 'quarry', 'minerals'] },
  { code: 'national_security', label: 'National Security/Defence', aliases: ['national security', 'defence', 'defense', 'military', 'army', 'navy', 'air force', 'police', 'immigration', 'prisons', 'security'] },
  { code: 'ngo', label: 'NGO', aliases: ['ngo', 'non governmental', 'nonprofit', 'non profit', 'charity', 'humanitarian', 'development partner', 'donor'] },
  { code: 'public_sector', label: 'Public Sector', aliases: ['public sector', 'government', 'ministry', 'municipal', 'district assembly', 'civil service', 'parastatal', 'authority', 'agency', 'commission'] },
  { code: 'telecom_it', label: 'Telecom and IT', aliases: ['telecom', 'telecoms', 'telecommunication', 'it', 'ict', 'software', 'technology', 'tech', 'computing', 'data', 'isp', 'cyber security', 'cybersecurity'] },
  { code: 'transport_logistics', label: 'Transport and Logistics', aliases: ['transport', 'logistics', 'shipping', 'freight', 'haulage', 'courier', 'port', 'aviation', 'airline', 'warehousing'] },
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

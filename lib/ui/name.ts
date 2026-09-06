/**
 * Displaying a person's name.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Names arrive from four places — a marketer typing into a form, a Facebook
 * lead-ad payload, a pasted CSV, a self-service application — and a good
 * proportion of them come in shouting: "PAUL ANGKYELLE". In a list beside
 * "Bright Ayiku" that reads as emphasis the data never meant, and on a
 * dashboard of people waiting it looks like the loudest row is the most
 * urgent one when it is simply the one somebody typed with caps lock on.
 *
 * The stored value is never changed. This is a display concern only: the
 * record keeps exactly what was entered, because that is what the person
 * wrote and what an export or a letter should reproduce.
 */

/** Particles that stay lowercase inside a name, but not at the start. */
const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'du', 'da', 'di', 'la', 'le', 'bin', 'binte', 'al'])

/** Prefixes whose following letter is capitalised: McDonald, O'Brien. */
const RECASE = /^(mc|mac|o')(.+)$/i

function word(w: string, index: number): string {
  const lower = w.toLowerCase()

  if (index > 0 && PARTICLES.has(lower)) return lower

  const m = lower.match(RECASE)
  if (m && m[2].length > 1) {
    return m[1].charAt(0).toUpperCase() + m[1].slice(1) + m[2].charAt(0).toUpperCase() + m[2].slice(1)
  }

  // Hyphens and apostrophes start a new word: Ama-Serwaa, N'Diaye.
  return lower.replace(/(^|[-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
}

/**
 * A name as it should appear on screen.
 *
 * Only SHOUTED names are touched. A name that already has mixed case was
 * typed deliberately — "de Souza", "van Dyk", an initialism somebody meant —
 * and is returned untouched, because guessing at it would be worse than
 * leaving it alone.
 */
export function displayName(raw: string | null | undefined): string {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!name) return ''

  // Any lowercase letter at all means the case was chosen, not defaulted.
  if (/\p{Ll}/u.test(name)) return name

  // A short all-caps string is far more likely an initialism than a shout.
  if (name.length <= 3) return name

  return name.split(' ').map(word).join(' ')
}

/** The first name, for a greeting. Falls back to the whole thing. */
export function firstName(raw: string | null | undefined): string {
  const full = displayName(raw)
  return full.split(' ')[0] || full
}

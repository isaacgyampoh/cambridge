/**
 * THE BRAND. One source of truth.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * The product name appeared literally in 110 places: page metadata, the login
 * screen, every email template, the SMS sender and message bodies, the
 * certificate, the referral page, the student portal, admission letters. A
 * rename meant finding and editing all of them and hoping none were missed —
 * and the ones most easily missed are the ones customers see, because they
 * live in email and SMS templates rather than on screen.
 *
 * Everything user-facing now reads from here. Renaming the product is editing
 * this file.
 *
 * ── WHAT BELONGS HERE ──────────────────────────────────────────────────────
 *
 * Identity and voice. Not colours, spacing or typography — those are design
 * tokens and live in app/globals.css, because a rename should not disturb the
 * visual system and a visual change should not disturb the name.
 */

export const BRAND = {
  /** The full legal-ish name. Letterheads, page titles, formal email copy. */
  name: 'Cambridge Center of Excellence',

  /** For tight spaces: the browser tab, the sidebar, a mobile header. */
  shortName: 'Cambridge',

  /** How the product refers to itself to staff. */
  portalName: 'Staff Portal',

  /** One sentence, for metadata and share cards. */
  description:
    'Professional and executive certification training in Ghana — PMP, HR (PHRi/SPHRi) and more.',

  /** The line under the sign-in heading. Short, plain, no marketing. */
  tagline: 'Where every lead becomes a graduate.',

  /**
   * The SMS sender id, as registered with the provider.
   *
   * Changing this requires the provider to approve the new id first — an
   * unregistered sender is silently dropped by the networks, so it is called
   * out here rather than being quietly renamed with everything else.
   */
  smsSender: 'CambridgeCE',

  /** Where staff and students write for help. */
  supportEmail: 'info@cambridge.edu.gh',

  /** The address the super-admin account is bound to. */
  adminEmail: 'admin@cambridge.edu.gh',

  /** Asset paths. Replacing the artwork is replacing these files. */
  logo: '/brand/logo.png',
  favicon: '/favicon.ico',
  appleTouchIcon: '/icons/apple-touch-icon.png',
} as const

/**
 * How the product signs off in a message.
 *
 * Templates used a mix of "CCE", "Cambridge" and the full name, so the same
 * student could receive three messages that appeared to come from three
 * organisations.
 */
export const BRAND_VOICE = {
  /** Prefix on an SMS. Kept short — every character is billed. */
  smsPrefix: 'CCE',

  /** How an email signs off. */
  emailSignature: BRAND.name,

  /** Used in a sentence: "Welcome to …". */
  inSentence: BRAND.name,
} as const

/** The browser tab: "Leads · Cambridge". */
export function pageTitle(section?: string): string {
  return section ? `${section} · ${BRAND.shortName}` : BRAND.name
}

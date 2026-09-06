/**
 * Device-native contact actions.
 *
 * A staff member chasing a lead on a phone should tap "Call" and be in the
 * dialler, not be shown a number to memorise and retype. These build the
 * hrefs that make the phone do the work — `tel:` for the dialler and
 * wa.me for WhatsApp, which opens the installed app when there is one and
 * falls back to the web client when there is not.
 *
 * Pure and dependency-free so the number handling is under test: a malformed
 * tel: link fails silently on a phone, which is the worst kind of broken.
 */

/**
 * Normalise a Ghanaian number to international digits.
 *
 * Deliberately the same rule as lib/integrations/sms.ts uses for delivery, so
 * the number a person taps to call is the number the system texts. Returns
 * null rather than guessing when it is not a number we recognise.
 */
export function canonicalContact(raw: string | null | undefined): string | null {
  const cleaned = String(raw || '')
    .replace(/\s+/g, '')
    .replace(/^\+233/, '233')
    .replace(/^\+/, '')
    .replace(/^0/, '233')
  const digits = cleaned.replace(/[^0-9]/g, '')
  if (!/^233\d{9}$/.test(digits)) return null
  return digits
}

/** How the number is shown to a Ghanaian reader: 0201234567, not 233201234567. */
export function displayPhone(raw: string | null | undefined): string {
  const canonical = canonicalContact(raw)
  if (!canonical) return String(raw || '').trim() || '—'
  return '0' + canonical.slice(3)
}

/** A dialler link, or null when there is nothing safe to dial. */
export function telHref(raw: string | null | undefined): string | null {
  const canonical = canonicalContact(raw)
  return canonical ? `tel:+${canonical}` : null
}

/**
 * A WhatsApp link, optionally pre-filling the first message.
 *
 * wa.me rather than whatsapp:// because the former works on a desktop browser
 * too, so the same button is useful to someone at a desk.
 */
export function whatsappHref(
  raw: string | null | undefined,
  message?: string
): string | null {
  const canonical = canonicalContact(raw)
  if (!canonical) return null
  const query = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${canonical}${query}`
}

/** An email link, or null when the address is not one. */
export function mailtoHref(email: string | null | undefined, subject?: string): string | null {
  const value = String(email || '').trim()
  // Deliberately loose: the job is to avoid building a broken link, not to
  // adjudicate what a valid address is.
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null
  return `mailto:${value}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`
}

/**
 * Mask an address for display: i****c@cambridge.edu.gh
 *
 * Shown on the OTP screen to confirm WHERE the code went without publishing
 * the address to whoever is looking at the screen — which matters when the
 * only thing standing between an attacker and an account is that code.
 */
export function maskEmail(email: string | null | undefined): string {
  const value = String(email || '').trim()
  const at = value.lastIndexOf('@')
  if (at < 1) return 'your corporate email'
  const name = value.slice(0, at)
  const domain = value.slice(at)
  if (name.length <= 2) return `${name[0]}${'*'.repeat(3)}${domain}`
  return `${name[0]}${'*'.repeat(Math.min(name.length - 2, 6))}${name[name.length - 1]}${domain}`
}

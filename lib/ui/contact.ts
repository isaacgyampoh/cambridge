/*
 * A relative import, deliberately. This module is unit tested directly by the
 * node test runner, which does not resolve the '@/' path alias — an aliased
 * import here would make the whole file unloadable in a test, and the number
 * handling is exactly what most needs testing.
 */
import { canonicalGhanaMobile } from '../phone.ts'
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
  return canonicalGhanaMobile(raw)
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
 * A WhatsApp link to ONE person, optionally pre-filling the first message.
 *
 * ── WHY https://wa.me AND NOT whatsapp:// ──────────────────────────────────
 *
 * wa.me is an ordinary HTTPS URL, so Android matches it against WhatsApp's
 * own App Links intent filter and hands the navigation straight to the
 * installed app. A `whatsapp://` custom scheme has no such registration in a
 * browser context: when the app is missing there is nothing to catch it and
 * the tap does nothing at all, and desktop has no handler for it ever.
 *
 * ── AND WHY THE NUMBER IS ALWAYS IN THE PATH ───────────────────────────────
 *
 * `https://wa.me/233...` addresses a conversation. `https://wa.me/?text=...`
 * — with no number — is a SHARE intent: it asks the device "who should this
 * go to", and on Android that question is answered by the system chooser,
 * which lists every app that accepts text. Messages is one of them, so a
 * person aiming at WhatsApp can land in an SMS/MMS composer without the
 * application ever having emitted an sms: URI.
 *
 * That is why the two are separate functions with separate names. A button
 * that means "message this lead" must never be built from the share form.
 * See whatsappShareHref below for the case where choosing a recipient IS the
 * point.
 */
export function whatsappHref(
  raw: string | null | undefined,
  message?: string
): string | null {
  const canonical = canonicalContact(raw)
  if (!canonical) return null
  /*
   * URLSearchParams rather than hand-assembly: it percent-encodes the whole
   * value, so a '+' in the text stays a '+' instead of arriving as a space,
   * and '&', '#', '?' and newlines cannot terminate or split the query.
   */
  if (!message) return `https://wa.me/${canonical}`
  return `https://wa.me/${canonical}?${new URLSearchParams({ text: message })}`
}

/**
 * A WhatsApp link with NO recipient — "send this to someone you choose".
 *
 * The numberless form is correct here and only here: sharing a flyer or a
 * marketing link is exactly the case where the person picks the recipient.
 * It is named differently from whatsappHref so that choosing it is a
 * decision rather than an accident, because on Android it can surface the
 * system chooser rather than WhatsApp directly.
 */
export function whatsappShareHref(text: string): string {
  return `https://wa.me/?${new URLSearchParams({ text })}`
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
 * Mask an address for display: i•••••@cambridge.edu.gh
 *
 * Shown on the OTP screen to confirm WHICH mailbox the code went to, without
 * publishing the address to whoever is looking at the screen — which matters
 * when that code is the only thing standing between an attacker and an
 * account.
 *
 * The mask is a FIXED width rather than one character per hidden letter. A
 * variable-length mask tells an observer exactly how long the username is,
 * which is a free hint towards guessing it, and confirming the mailbox does
 * not require giving that away.
 */
export function maskEmail(email: string | null | undefined): string {
  const value = String(email || '').trim()
  const at = value.lastIndexOf('@')
  if (at < 1) return 'your corporate email'
  return `${value[0]}${'•'.repeat(5)}${value.slice(at)}`
}

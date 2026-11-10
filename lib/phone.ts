/**
 * ONE RULE FOR TURNING A GHANAIAN NUMBER INTO AN INTERNATIONAL ONE.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * The same rule was written out three times — in lib/ui/contact.ts for the
 * tap-to-call and WhatsApp links, in lib/integrations/smsRecipient.ts for
 * Arkesel, and in lib/integrations/whatsapp.ts for WaSender. Three copies of
 * one decision, each free to drift.
 *
 * They had already drifted in one direction and agreed in another: all three
 * turned "00233241234567" into
 *
 *     2330233241234567
 *
 * because the leading 0 of the 00 dialling prefix was rewritten to 233 before
 * anything had looked at the 00. Two of the three then validated the result
 * and returned null, so a number stored that way produced no Call button and
 * no WhatsApp link at all. The third did not validate, so it handed a
 * sixteen-digit number to the provider.
 *
 * Fixing that in one place and not the others would have left the copies
 * disagreeing, which is worse than all three being wrong in the same way. So
 * there is now one function, and the three callers delegate to it.
 *
 * Pure and import-free, so it can be unit tested directly and used on both
 * the server and the client.
 */

/**
 * A Ghanaian mobile, as it is stored and dialled: 233 then nine digits
 * beginning 2 or 5 — every network's prefix is 02x or 05x.
 *
 * The prefix is checked rather than the length alone, because this value is
 * where a PIN and a sign-in code are sent. Nine digits that are not a phone
 * number — an ID, a reference, half of something pasted — would otherwise be
 * turned into a plausible-looking recipient and the credential sent into the
 * dark.
 */
const GHANA_MOBILE = /^[25]\d{8}$/

/**
 * Normalise to 233XXXXXXXXX, or null when it is not a Ghanaian mobile.
 *
 * ── THE FORMS THIS NOW RESCUES, AND WHY IT MUST ────────────────────────────
 *
 * This function decides whether somebody can be TEXTED at all: a null here
 * means no SMS channel, and with the campus mailbox unconfigured that means
 * no PIN reset, no sign-in code, nothing. It was stricter than the rule the
 * lead import has used all along, and stricter than what the staff screens
 * actually write, so numbers that were accepted when they were saved became
 * unreachable when somebody tried to use them:
 *
 *   2330244721555   "+233 (0) 244 721 555" — the international form with the
 *                   trunk zero kept. Both staff writers store this verbatim,
 *                   and the old rule read it as thirteen digits and refused.
 *
 *   244721555       the leading zero gone — what a spreadsheet does to a
 *                   phone column, and what a person types when they are
 *                   already giving the country code elsewhere.
 *
 * Reading those correctly repairs the rows already in the database without
 * touching them: the stored text does not change, but the person becomes
 * reachable again.
 *
 * Still null rather than a best guess for anything genuinely ambiguous — two
 * numbers in one field, a landline, a foreign number. A malformed tel: link
 * fails silently when tapped and a malformed recipient is a message that
 * never arrives, but a GUESSED recipient is a PIN sent to a stranger.
 */
export function canonicalGhanaMobile(raw: string | null | undefined): string | null {
  /*
   * Every separator a person might type or paste, and the international
   * dialling prefix BEFORE the single-zero rule — without that, "00233…" has
   * its first zero rewritten and comes out as a duplicated country code.
   */
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^00/, '')
  if (!digits) return null

  // Country code, then the trunk zero. Both optional, in that order, which is
  // what makes "233 0 244721555" and "0244721555" and "244721555" one number.
  const local = digits.replace(/^233/, '').replace(/^0/, '')

  return GHANA_MOBILE.test(local) ? `233${local}` : null
}

/** How the number is shown to a Ghanaian reader: 0201234567. */
export function localGhanaMobile(raw: string | null | undefined): string | null {
  const canonical = canonicalGhanaMobile(raw)
  return canonical ? '0' + canonical.slice(3) : null
}

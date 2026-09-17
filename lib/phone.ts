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

/** A Ghanaian mobile number: 233 followed by nine digits. */
const GHANA_MOBILE = /^233\d{9}$/

/**
 * Normalise to 233XXXXXXXXX, or null when it is not a Ghanaian mobile.
 *
 * Null rather than a best guess: a malformed tel: link fails silently when
 * tapped, and a malformed recipient is a message that never arrives. Both are
 * worse than a button that is honestly absent.
 */
export function canonicalGhanaMobile(raw: string | null | undefined): string | null {
  const cleaned = String(raw ?? '')
    // Everything a person might type or paste: spaces, dashes, brackets, dots.
    .replace(/[\s()\-.]/g, '')
    .replace(/^\+233/, '233')
    .replace(/^\+/, '')
    /*
     * The international dialling prefix, BEFORE the single-zero rule. This is
     * the line the three copies were missing: without it "00233…" has its
     * first zero rewritten and comes out as a duplicated country code.
     */
    .replace(/^00/, '')
    .replace(/^0/, '233')

  const digits = cleaned.replace(/[^0-9]/g, '')
  return GHANA_MOBILE.test(digits) ? digits : null
}

/** How the number is shown to a Ghanaian reader: 0201234567. */
export function localGhanaMobile(raw: string | null | undefined): string | null {
  const canonical = canonicalGhanaMobile(raw)
  return canonical ? '0' + canonical.slice(3) : null
}

/*
 * Take the credentials back out of the SMS delivery log.
 *
 * ── WHAT WENT WRONG ────────────────────────────────────────────────────────
 *
 * sms_logs stores the body of every text the system sends, and
 * /admin/sms-delivery shows it to anyone holding the `broadcast` or
 * `settings` portal. That was written when every message was a class reminder
 * or a voucher request — the comment beside the query said so, in as many
 * words: "it never contains a credential".
 *
 * The staff onboarding message has carried an initial PIN since it was
 * written, and sign-in codes and PIN resets now go by SMS as well. So the log
 * holds working credentials, readable by colleagues who have no business
 * reading them, and a sign-in code lasts six hours.
 *
 * New sends no longer store those bodies: lib/integrations/sms.ts logs a
 * label for any message marked `credential`. This migration deals with the
 * rows written before that.
 *
 * ── WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────
 *
 * It replaces the BODY of rows that match a credential-bearing message, and
 * nothing else. Recipient, status, attempts, timestamps, the provider
 * reference and the error are all kept, because that is what the delivery
 * screen is for — the digits were never part of diagnosing a delivery.
 *
 * It does not delete rows. "Why did this person never get their PIN?" is
 * still answerable afterwards.
 *
 * Matching is by the phrasing those messages actually used, not by "any four
 * digits": a fee reminder says GHS 5950 and a class reminder gives a date,
 * and neither is a credential.
 */

-- Onboarding: "Login with your phone (0241234567) and PIN: 4821"
-- and the current wording, "Sign in at … with PIN 4821".
UPDATE sms_logs
SET message = '[not stored: staff onboarding carried a one-time credential]',
    kind = COALESCE(kind, 'staff_onboarding')
WHERE message ~* '\yPIN:?\s*[0-9]{4}\y'
  AND message ILIKE '%welcome%';

-- A PIN reset: "your portal PIN has been reset to 4821".
UPDATE sms_logs
SET message = '[not stored: pin reset carried a one-time credential]',
    kind = COALESCE(kind, 'pin_reset')
WHERE message ~* 'PIN has been reset to\s*[0-9]{4}';

-- A sign-in code: "Your … sign-in code is 481902".
UPDATE sms_logs
SET message = '[not stored: auth code carried a one-time credential]',
    kind = COALESCE(kind, 'auth_code')
WHERE message ~* 'sign-in code is\s*[0-9]{4,8}';

/*
 * Anything else that still looks like a PIN beside the word PIN. Last,
 * deliberately, so the three cases above keep their own labels.
 */
UPDATE sms_logs
SET message = '[not stored: this message carried a one-time credential]'
WHERE message ~* '\yPIN:?\s*[0-9]{4}\y';

-- What is left, for the person running this:
--
--   SELECT count(*) FROM sms_logs WHERE message ~* '\yPIN:?\s*[0-9]{4}\y';
--
-- Should be 0.

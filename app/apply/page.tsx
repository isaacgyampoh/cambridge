import type { Metadata } from 'next'
import { BRAND } from '@/lib/brand'
import ApplicationPage from './[marketerId]/page'

export const metadata: Metadata = {
  title: `Enquire · ${BRAND.shortName}`,
  description: BRAND.description,
}

/**
 * A general enquiry, with nobody's referral code on it.
 *
 * ── WHY THIS ROUTE HAD TO EXIST ────────────────────────────────────────────
 *
 * /apply was only ever /apply/[marketerId] — the personal link a marketer
 * shares. There was no way to enquire without holding somebody's code, so a
 * visitor who found the centre any other way had nowhere to go. The new front
 * page needed somewhere to send them, and inventing a code to satisfy the URL
 * would have credited a person who had nothing to do with it.
 *
 * ── AND WHY IT REUSES THE FORM RATHER THAN COPYING IT ──────────────────────
 *
 * The application form is one long, carefully-built component with payment,
 * validation, duplicate handling and a Paystack return path. A second copy of
 * it would be a second place for every future fix to be needed, and the one
 * most easily forgotten is the one fewer people open.
 *
 * It already handles an unknown marketer — it resolves the code server-side
 * and falls back to `marketer: null`, sending null attribution on submit. An
 * empty code takes exactly that path, so the lead is created unattributed and
 * distributed by the weighted lottery like any other, which is the correct
 * outcome for somebody who arrived without a referral.
 */
export default function GeneralEnquiry() {
  return <ApplicationPage params={Promise.resolve({ marketerId: '' })} />
}

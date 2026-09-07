import type { Metadata } from 'next'
import { shareMetadata } from '@/lib/share/metadata'
import { BRAND } from '@/lib/brand'

/**
 * The registration link's share card.
 *
 * A layout rather than the page, because the page is a client component — a
 * large form with uploads — and metadata can only be exported from the server.
 * This adds the card without touching the form or its logic.
 *
 * The marketer's code is deliberately NOT named in the title or description.
 * The card is what a prospective student sees in a WhatsApp group; the person
 * who shared it does not need announcing, and their referral code is not
 * something to broadcast. Attribution still happens — the code is in the URL
 * and resolved on the server when the form is submitted.
 */
export const metadata: Metadata = shareMetadata({
  title: `Apply to ${BRAND.shortName}`,
  description:
    'Professional and executive certification training in Ghana. Complete your details to begin your application.',
  path: '/apply',
})

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return children
}

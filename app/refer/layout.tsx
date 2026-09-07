import type { Metadata } from 'next'
import { shareMetadata } from '@/lib/share/metadata'
import { BRAND } from '@/lib/brand'

/**
 * The referral link's share card. See app/apply/[marketerId]/layout.tsx —
 * the same reasoning, and the same silence about who shared it.
 */
export const metadata: Metadata = shareMetadata({
  title: `Train with ${BRAND.shortName}`,
  description:
    'Professional and executive certification training in Ghana. Leave your details and a course advisor will be in touch.',
  path: '/refer',
})

export default function ReferLayout({ children }: { children: React.ReactNode }) {
  return children
}

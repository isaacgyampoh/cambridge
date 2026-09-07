import 'server-only'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Metadata } from 'next'
import { BRAND } from '@/lib/brand'

/**
 * What a link looks like when somebody shares it.
 *
 * ── THE PROBLEM THIS SOLVES ────────────────────────────────────────────────
 *
 * Every platform that renders a link preview — WhatsApp, Facebook, LinkedIn,
 * X, Telegram — fetches the URL with a crawler that does not run JavaScript.
 * Every public page in this product was a client component, so a crawler
 * received an empty shell and fell back to the root layout: the crest at
 * 512px, and the site's own description.
 *
 * That is the difference between a marketer posting a link that looks like an
 * invitation and one that looks like a stray URL, and it is the whole reason
 * people paste a screenshot of a flyer instead — which cannot be tapped and
 * carries no attribution.
 *
 * ── THE CARD IMAGE ─────────────────────────────────────────────────────────
 *
 * A share card wants a wide image. The crest is square, so a platform either
 * letterboxes it into a grey field or shows a thumbnail. Any of these files,
 * if present, is used instead — save one and every public link improves at
 * once:
 *
 *   public/brand/share-card.jpg   (1200 x 630 is the size platforms expect)
 *   public/brand/login-hero.jpg   (the sign-in photograph, reused)
 *
 * Neither is required. With no wide image the card still carries the right
 * title and description, which is already far better than the generic one.
 */

const WIDE_CANDIDATES = [
  'brand/share-card.jpg',
  'brand/share-card.png',
  'brand/share-card.webp',
  'brand/login-hero.jpg',
  'brand/login-hero.jpeg',
  'brand/login-hero.png',
  'brand/login-hero.webp',
] as const

/** The widest brand image available, or the crest as a last resort. */
export function shareImage(): { url: string; wide: boolean } {
  const found = WIDE_CANDIDATES.find(f => existsSync(join(process.cwd(), 'public', f)))
  return found ? { url: `/${found}`, wide: true } : { url: BRAND.logo, wide: false }
}

/**
 * Metadata for a public page that people will share.
 *
 * `noIndex` defaults to true: these are links sent to a person, not pages that
 * should compete with the centre's own site in a search result.
 */
export function shareMetadata({
  title, description, path, image, noIndex = true,
}: {
  title: string
  description: string
  path: string
  /** Overrides the brand image — a flyer, for instance. */
  image?: string | null
  noIndex?: boolean
}): Metadata {
  const picked = image ? { url: image, wide: true } : shareImage()

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: BRAND.name,
      title,
      description,
      url: path,
      images: [{
        url: picked.url,
        // Declared because several platforms will not render a large card
        // without dimensions, and WhatsApp falls back to a thumbnail.
        width: picked.wide ? 1200 : 512,
        height: picked.wide ? 630 : 512,
        alt: title,
      }],
    },
    twitter: {
      // A `summary` card is a thumbnail beside text — the small grey square
      // this product was producing. A large card shows the image properly.
      card: picked.wide ? 'summary_large_image' : 'summary',
      title,
      description,
      images: [picked.url],
    },
    robots: noIndex ? { index: false, follow: false } : undefined,
  }
}

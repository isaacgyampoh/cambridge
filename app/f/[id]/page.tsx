import type { Metadata } from 'next'
import { loadPublicFlyer } from '@/lib/flyers/publicFlyer'
import { BRAND } from '@/lib/brand'
import FlyerLanding from './FlyerLanding'

export const runtime = 'nodejs'

/**
 * A marketer's flyer, as a shareable link.
 *
 * ── WHY THIS IS A SERVER COMPONENT ─────────────────────────────────────────
 *
 * Because of what happens when the link is pasted into WhatsApp.
 *
 * Every platform that renders a link preview — WhatsApp, Facebook, LinkedIn,
 * X, Telegram — fetches the URL with a crawler that does NOT run JavaScript.
 * This page used to fetch its own flyer from the browser, so all a crawler
 * ever received was an empty shell. It fell back to the root layout's
 * metadata, and the preview showed the Cambridge crest at 512px with the
 * site's generic description.
 *
 * So a marketer sharing their flyer got a small grey logo card. The flyer they
 * had made, the whole point of sharing, was never in the preview.
 *
 * Reading the flyer here fixes both halves at once: generateMetadata can name
 * the actual image, and the page arrives already rendered.
 */

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const flyer = await loadPublicFlyer(id)

  if (!flyer) {
    return { title: BRAND.name, robots: { index: false, follow: false } }
  }

  const title = flyer.title || `${flyer.course || 'Professional training'} · ${BRAND.shortName}`
  const description = flyer.course
    ? `${flyer.course} at ${BRAND.name}. Tap to see the programme and apply.`
    : `Tap to see the programme and apply at ${BRAND.name}.`

  /*
   * The flyer itself is the preview image.
   *
   * `summary_large_image` rather than `summary`: a summary card is a thumbnail
   * beside text, which is exactly the small grey square this page was
   * producing. A large card shows the flyer at full width, which is the point.
   *
   * Dimensions are declared because several platforms will not render a large
   * card without them, and WhatsApp in particular falls back to a thumbnail.
   * The values describe the CARD, not the file — the image is letterboxed into
   * them rather than cropped by them.
   */
  const image = flyer.imageUrl
  const images = image
    ? [{ url: image, width: 1200, height: 630, alt: title }]
    : undefined

  return {
    title,
    description,
    alternates: { canonical: `/f/${flyer.id}` },
    openGraph: {
      type: 'website',
      siteName: BRAND.name,
      title,
      description,
      url: `/f/${flyer.id}`,
      images,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      images: image ? [image] : undefined,
    },
    /*
     * A personal campaign link is not site content. It should reach the people
     * it was sent to, not a search index — and a marketer's flyers should not
     * compete with the centre's own pages.
     */
    robots: { index: false, follow: false },
  }
}

export default async function FlyerPage({ params }: Props) {
  const { id } = await params
  const flyer = await loadPublicFlyer(id)

  if (!flyer) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center"
        style={{ background: 'var(--canvas)' }}>
        <div>
          <p className="text-[15px] font-semibold text-[var(--ink)]">
            This link is no longer available
          </p>
          <p className="text-[14px] text-[var(--ink-soft)] mt-1.5">
            Ask whoever shared it with you for an up-to-date one.
          </p>
        </div>
      </div>
    )
  }

  return <FlyerLanding flyer={flyer} />
}

import type { Metadata } from 'next'
import { BRAND } from '@/lib/brand'
import { loadMarketingPage, registerHref } from '@/lib/marketing/link'
import MarketingLanding from './MarketingLanding'

export const runtime = 'nodejs'

/**
 * A member of staff's permanent marketing link.
 *
 * ── WHAT MAKES IT PERMANENT ────────────────────────────────────────────────
 *
 * The URL names a PERSON, not a campaign. /m/ada-4f21 is Ada's for as long as
 * she works here — it goes on a QR code, a printed flyer, an Instagram bio,
 * the back of a business card — and what it shows is decided every time it is
 * opened, by whatever the centre is currently running.
 *
 * The alternative, a link per campaign, means reprinting everything each time
 * the programme changes, and old cards leading to a cohort that finished
 * months ago.
 *
 * ── WHY THIS IS A SERVER COMPONENT ─────────────────────────────────────────
 *
 * The same reason as /f/[id]: WhatsApp, Facebook and LinkedIn fetch a shared
 * link with a crawler that does not run JavaScript. A page that loaded itself
 * from the browser would preview as the site's generic card, so the one thing
 * a staff member is trying to show — the programme — would never appear.
 *
 * ── AND WHY IT IS DELIBERATELY NOT INDEXED ─────────────────────────────────
 *
 * Dozens of staff links all carrying the centre's current programme would
 * compete with the centre's own pages for it, and with each other. These are
 * links to be sent to people, not pages to be found.
 */

export const revalidate = 300

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const page = await loadMarketingPage(slug)

  if (!page) {
    return { title: BRAND.name, robots: { index: false, follow: false } }
  }

  const { marketer, promotion } = page

  const title = promotion
    ? `${promotion.programme.name} — ${promotion.modeLabel} · ${BRAND.shortName}`
    : `Professional training · ${BRAND.shortName}`

  const description = promotion
    ? [
        promotion.cohort.startDateText ? `Starts ${promotion.cohort.startDateText}.` : null,
        promotion.fee ? `GHS ${promotion.fee.toLocaleString('en-GH')}.` : null,
        `Shared by ${marketer.name}. Tap to register.`,
      ].filter(Boolean).join(' ')
    : `${BRAND.name}. Shared by ${marketer.name}. Tap to see our programmes.`

  /*
   * `images` is deliberately absent.
   *
   * opengraph-image.tsx sits beside this file, and Next attaches it to both
   * the Open Graph and Twitter cards automatically. Naming an image here as
   * well would override the generated one with a fixed file — which is the
   * stale-card problem this page exists to avoid.
   *
   * Not a flyer, either: a flyer belongs to one marketer and one campaign,
   * while this link outlives both, so it would show last term's programme
   * after the promotion had moved on.
   */
  return {
    title,
    description,
    alternates: { canonical: `/m/${marketer.code}` },
    openGraph: {
      type: 'website',
      siteName: BRAND.name,
      title,
      description,
      url: `/m/${marketer.code}`,
    },
    twitter: { card: 'summary_large_image', title, description },
    robots: { index: false, follow: false },
  }
}

export default async function MarketingLinkPage({ params }: Props) {
  const { slug } = await params
  const page = await loadMarketingPage(slug)

  if (!page) {
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

  return (
    <MarketingLanding
      marketerName={page.marketer.name}
      promotion={page.promotion}
      programmes={page.programmes}
      programmesUnavailable={page.programmesUnavailable}
      registerHref={registerHref(page.marketer.code, page.promotion?.programme.name ?? null)}
    />
  )
}

import type { Metadata } from 'next'
import { BRAND } from '@/lib/brand'
import { loadMarketingPage, registerHref } from '@/lib/marketing/link'
import MarketingLanding from './MarketingLanding'
import VisitBeacon from './VisitBeacon'

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

/*
 * Rendered per request, never at build time.
 *
 * The slug is a member of staff's code, so there is no finite set of these to
 * prerender — and attempting it makes the build do a database round trip for
 * a page nobody has asked for. That is not hypothetical: adding this route
 * with `revalidate` alone put two more programme reads into build-time page
 * collection, and on a machine that cannot reach the database each one held a
 * worker for its full timeout until an unrelated page, /welcome, ran out of
 * time and the whole build failed.
 *
 * A marketing link must also be CURRENT. Somebody opens it minutes after a
 * colleague sends it, and the fee and start date on it are the centre's
 * answer — a cached copy from a previous cohort is the one thing this page
 * cannot afford to show.
 */
export const dynamic = 'force-dynamic'

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
    <>
      {/* Counts a real open. Not the page render: WhatsApp and Facebook fetch
          this page to build a link preview, so counting renders would count
          every time the link was PASTED. */}
      <VisitBeacon code={page.marketer.code} courseId={page.promotion?.programme.id ?? null} />
      <MarketingLanding
        marketerName={page.marketer.name}
        promotion={page.promotion}
        programmes={page.programmes}
        programmesUnavailable={page.programmesUnavailable}
        registerHref={registerHref(page.marketer.code, page.promotion?.programme.name ?? null)}
      />
    </>
  )
}

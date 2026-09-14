import { ImageResponse } from 'next/og'
import { BRAND } from '@/lib/brand'
import { loadMarketingPage } from '@/lib/marketing/link'

export const runtime = 'nodejs'
// Same reason as the page: no finite set of slugs, and nothing to gain from
// building a card for a link that may never be shared.
export const dynamic = 'force-dynamic'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = `Professional training at ${BRAND.name}`

/**
 * The card WhatsApp shows when a staff marketing link is shared.
 *
 * ── WHY THIS IS GENERATED RATHER THAN A FILE ───────────────────────────────
 *
 * The page behind /m/{code} changes whenever the centre schedules a different
 * cohort. A fixed image would therefore be wrong most of the time — showing
 * last term's programme on a link somebody is sharing today — and the whole
 * point of a permanent link is that the staff member never has to think about
 * it again. A card rendered from the same data as the page cannot go stale.
 *
 * The site's own card is /brand/logo.png at 512x512, which is what /f/[id]
 * was already complaining about: a small square logo beside grey text, on
 * every link, telling the reader nothing. A programme name, a start date and
 * a fee is the reason somebody taps.
 *
 * ── NO WEB FONTS ───────────────────────────────────────────────────────────
 *
 * ImageResponse would need the font file fetched at render time, and a font
 * fetch that fails takes the whole card with it — leaving WhatsApp with
 * nothing. The system stack renders everywhere and cannot fail to load.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  // Deliberately tolerant: a card is never worth failing a page over. If
  // anything here cannot be read, the generic centre card is still a card.
  let heading: string = 'Professional training'
  let line: string = BRAND.name
  let footer: string = ''

  try {
    const page = await loadMarketingPage(slug)
    if (page) {
      const { promotion, marketer } = page
      if (promotion) {
        heading = promotion.programme.name
        line = [
          promotion.modeLabel,
          promotion.cohort.startDateText ? `Starts ${promotion.cohort.startDateText}` : null,
          promotion.fee ? `GHS ${promotion.fee.toLocaleString('en-GH')}` : null,
        ].filter(Boolean).join('  ·  ')
      }
      footer = `Shared by ${marketer.name}`
    }
  } catch {
    // Falls through to the generic card.
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between', padding: '72px 80px',
          background: '#14140f', color: '#f5f3ec',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <div style={{ display: 'flex', fontSize: 26, letterSpacing: 2, color: '#b9b3a1' }}>
          {BRAND.name.toUpperCase()}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'flex', fontSize: 68, fontWeight: 700, lineHeight: 1.1 }}>
            {heading}
          </div>
          <div style={{ display: 'flex', fontSize: 34, color: '#d8d2c2' }}>
            {line}
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 26, color: '#b9b3a1' }}>
          {footer}
        </div>
      </div>
    ),
    size,
  )
}

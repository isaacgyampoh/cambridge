/**
 * THE ONE ADDRESS THIS CENTRE HAS.
 *
 * ── WHAT WENT WRONG ────────────────────────────────────────────────────────
 *
 * Every customer-facing link was built from `CONFIG.appUrl`, which read
 * NEXT_PUBLIC_APP_URL and fell back to the real domain only when that variable
 * was unset. It was not unset. Production had it pointing at
 * `https://cambridge-mu.vercel.app`, and .env.local had `http://localhost:3000`
 * — so the brochure links on the public front page, the marketer's own
 * marketing link, registration links, WhatsApp shares and Open Graph URLs all
 * carried a deployment address instead of the centre's.
 *
 * A marketer shared that with a customer. It is the first thing anybody sees.
 *
 * NEXT_PUBLIC_* is also baked into the browser bundle at BUILD time, so a
 * build run on a laptop shipped `http://localhost:3000` inside the JavaScript
 * every visitor downloads — a link that cannot work for anybody but the person
 * who built it.
 *
 * ── WHY THE VARIABLE NO LONGER DECIDES ─────────────────────────────────────
 *
 * The centre has exactly one public address and it is not a deployment detail.
 * Reading it from the environment made it something that could be configured
 * wrongly, and it was, silently, for as long as anybody had been sharing
 * links.
 *
 * So in production this is a constant. The environment can still point
 * development at localhost, because that genuinely varies — but nothing a
 * deployment sets can put a vercel.app address in front of a customer again.
 */

/** The centre's public address. Not configurable, because it is not a choice. */
export const CANONICAL_ORIGIN = 'https://portal.cambridge.edu.gh'

/**
 * Where this application is, for building a link somebody outside will use.
 *
 * Production is always canonical. Development honours NEXT_PUBLIC_APP_URL so
 * that `next dev` on localhost:3000 produces links that work on localhost —
 * and only a localhost-shaped value is accepted even then, so a stray
 * deployment URL in a developer's .env cannot leak into anything.
 */
export function publicOrigin(): string {
  if (process.env.NODE_ENV === 'production') return CANONICAL_ORIGIN

  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || ''
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(configured)
    ? configured
    : CANONICAL_ORIGIN
}

/**
 * An absolute URL for a customer.
 *
 * Use this for anything that will be pasted into WhatsApp, printed on a card,
 * put behind a QR code, sent in an email or handed to a payment provider as a
 * return address. Relative paths inside the application do not need it and
 * should not use it.
 *
 * ```ts
 * publicUrl(`/m/${code}`)   // https://portal.cambridge.edu.gh/m/ada-4f21
 * ```
 */
export function publicUrl(path = '/'): string {
  const origin = publicOrigin().replace(/\/+$/, '')
  if (!path || path === '/') return origin
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`
}

/*
 * Hosts that are this application wearing a different name.
 *
 * A URL stored on one of these was correct when it was saved and is wrong
 * now. Anything else — Cloudinary, a provider's CDN, a genuine third party —
 * is left completely alone.
 */
const OUR_OTHER_HOSTS = /^(.*\.)?vercel\.app$|^localhost$|^127\.0\.0\.1$|^\[::1\]$/

/**
 * Repair a stored URL that names a deployment instead of the centre.
 *
 * ── WHY READ-TIME AND NOT A MIGRATION ──────────────────────────────────────
 *
 * The brochure links on the public front page were
 * `https://cambridge-mu.vercel.app/brochures/pmp-brochure.pdf`. No code builds
 * those — they are stored absolute in courses.brochure_url, saved back when
 * NEXT_PUBLIC_APP_URL pointed at the deployment alias. Fixing the code could
 * not reach them, because the code was never what produced them.
 *
 * A migration corrects the rows; 0020 does that. This corrects the ANSWER,
 * which matters for three reasons: it works before anybody runs the SQL, it
 * covers rows saved by paths the migration does not know about, and it keeps
 * working if the mistake is ever made again.
 *
 * The path is preserved exactly. Only the origin is replaced, and only when
 * it is one of ours.
 */
export function canonicalisePublicUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const raw = String(url).trim()
  if (!raw) return null

  // A relative path is already correct — it resolves against whatever host
  // served the page, which is the right behaviour.
  if (raw.startsWith('/')) return raw

  try {
    const parsed = new URL(raw)
    if (!OUR_OTHER_HOSTS.test(parsed.hostname)) return raw
    return `${CANONICAL_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    // Not a URL at all. Hand it back untouched rather than discard something
    // a person may still be able to use.
    return raw
  }
}

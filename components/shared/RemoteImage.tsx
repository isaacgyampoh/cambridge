/**
 * An image whose source is content, not an asset.
 *
 * ── WHY THIS IS NOT next/image ─────────────────────────────────────────────
 *
 * next/image is right for files this repository ships: it knows their size, it
 * can pick a format, and the URL cannot change underneath it. The logo on the
 * public pages goes through it for exactly that reason.
 *
 * These do not qualify. Their src comes out of the database — an alumni
 * photograph, a flyer, a payment screenshot, a file someone attached to a
 * message — and two things follow from that:
 *
 *   1. The host is not guaranteed. Uploads land on Supabase Storage today and
 *      older rows hold Cloudinary URLs, both of which next.config allows, but
 *      a photo URL an administrator pastes into a form can point anywhere. A
 *      host missing from remotePatterns does not degrade with next/image; the
 *      image throws and the page breaks. Trading a rendered photograph for a
 *      runtime error to satisfy a lint rule is a bad trade.
 *
 *   2. The dimensions are not known. next/image needs width and height or a
 *      positioned parent to fill, and neither is available for a file whose
 *      shape is whatever the person uploaded.
 *
 * So the rule is disabled once, here, where the reason is written down —
 * rather than at ten call sites where it would read as a shrug. It stays on
 * everywhere else, which is where it catches the mistake it exists to catch:
 * a local asset served unoptimised.
 *
 * ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
 *
 * Lazy loading and async decoding, which the bare tags did not have. On the
 * flyer grid and the message thread that is the difference between fetching
 * every image on mount and fetching the ones actually scrolled to.
 */

type Props = {
  src: string
  alt: string
  className?: string
  style?: React.CSSProperties
  /** Set for an image above the fold, where lazy loading would delay it. */
  eager?: boolean
}

export function RemoteImage({ src, alt, className, style, eager }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the note above
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  )
}

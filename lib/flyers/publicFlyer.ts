import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * One flyer, read on the server.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The flyer landing page fetched itself from the browser. That is invisible to
 * the only audience that matters when a link is shared: WhatsApp, Facebook and
 * every other platform fetch a URL and read the HTML WITHOUT running any
 * JavaScript. They saw an empty shell and fell back to the root layout's
 * metadata — the Cambridge crest at 512px and the site description.
 *
 * So a marketer posting their flyer got a small generic logo card, never the
 * flyer. Reading it here means generateMetadata can name the real image, and
 * the page arrives already rendered.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *
 * Counting the view. This function runs for crawlers as well as people — a
 * link pasted into a WhatsApp group is fetched by their servers, sometimes
 * several times — and counting those would make a marketer's figures
 * meaningless. The count stays where it was, on a beacon the browser fires,
 * so it means "a person opened this".
 */

export type PublicFlyer = {
  id: string
  title: string | null
  course: string | null
  imageUrl: string | null
  marketerName: string | null
  /** Their referral code, for the register-and-pay path. */
  marketerCode: string | null
}

export async function loadPublicFlyer(id: string): Promise<PublicFlyer | null> {
  // A malformed id must not reach the database as a query.
  if (!id || id.length > 100) return null

  const sb = createServiceClient()
  const { data, error } = await sb
    .from('flyers')
    .select('id, title, course, image_url, profiles:marketer_id(full_name, marketer_code)')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    // Surfaced rather than swallowed: a failed read and a deleted flyer must
    // not look identical, or a broken link looks like a removed one.
    console.error('[flyer] could not load', id, error.message)
    return null
  }
  if (!data) return null

  const owner = data.profiles as unknown as
    { full_name?: string; marketer_code?: string } | null

  return {
    id: data.id,
    title: data.title ?? null,
    course: data.course ?? null,
    imageUrl: data.image_url ?? null,
    marketerName: owner?.full_name ?? null,
    marketerCode: owner?.marketer_code ?? null,
  }
}

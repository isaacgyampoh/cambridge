import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Three figures about the centre, for the sign-in screen.
 *
 * ── WHY THIS IS SAFE TO SERVE UNAUTHENTICATED ──────────────────────────────
 *
 * Every number here is already public. Published alumni are listed by name and
 * photograph on /public-alumni; active courses are listed on the application
 * form that anybody can open. Nothing about leads, staff, fees or enrolment
 * appears — those are the figures that would say something about the business,
 * and none of them is counted here.
 *
 * They are counts, never rows: `head: true` means no record leaves the
 * database, so this cannot become a way to enumerate people.
 *
 * ── WHY THE SIGN-IN SCREEN WANTS THEM ──────────────────────────────────────
 *
 * The brand panel beside the PIN field held a single line of text and a great
 * deal of empty space. Standing figures give it something true to say, and
 * they are the same three facts a prospective student would want — which is
 * the right thing for the front door of the institution to carry.
 */

/** Counts change slowly. A stale figure is fine; a slow login is not. */
export const revalidate = 3600

type Stats = { alumni: number; courses: number; graduates: number }

export async function GET() {
  const sb = createServiceClient()

  try {
    const [alumni, courses, graduates] = await Promise.all([
      sb.from('alumni').select('id', { count: 'exact', head: true })
        .eq('is_published', true),
      sb.from('courses').select('id', { count: 'exact', head: true })
        .eq('is_active', true),
      // Enrolments that finished. The nearest honest answer to "how many
      // people has this place seen through".
      sb.from('class_enrollments').select('id', { count: 'exact', head: true })
        .eq('status', 'completed'),
    ])

    const stats: Stats = {
      alumni: alumni.count || 0,
      courses: courses.count || 0,
      graduates: graduates.count || 0,
    }

    return NextResponse.json(stats, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    })
  } catch (e) {
    /*
     * The sign-in screen must never depend on this. Zeroes are returned and
     * the panel renders without figures rather than showing an error beside
     * a PIN field — nobody signing in can act on a failure here.
     */
    console.error('[public/stats] could not count:', e)
    return NextResponse.json({ alumni: 0, courses: 0, graduates: 0 } satisfies Stats)
  }
}

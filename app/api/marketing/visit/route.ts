import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimit, clientIp } from '@/lib/auth/rateLimit'
import { recordVisit } from '@/lib/marketing/visits'

export const runtime = 'nodejs'

/**
 * "Somebody opened a marketing link."
 *
 * ── WHY A BEACON AND NOT A COUNT ON THE PAGE ───────────────────────────────
 *
 * /m/{code} is cached and served to crawlers. WhatsApp, Facebook and LinkedIn
 * all fetch it to build a link preview, so counting a render would count
 * every time a link was PASTED rather than every time it was opened — and a
 * marketer sharing to three groups would see visits they never got.
 *
 * A request from the browser after the page has rendered is the only thing
 * that means a person actually looked at it.
 *
 * ── WHAT IT ACCEPTS ────────────────────────────────────────────────────────
 *
 * A public endpoint that writes a row, so it is bounded on every axis: the
 * code and session are length-capped, the referrer is reduced to a hostname
 * before it is stored, and one IP may not file hundreds of visits an hour.
 *
 * It accepts no personal information of any kind, and there is nothing it
 * could be persuaded to store — the body has three known fields and the rest
 * is discarded by the schema.
 */

const Body = z.object({
  code: z.string().trim().min(1).max(100),
  /** Random, made up by the browser, meaningless anywhere else. */
  session: z.string().trim().min(8).max(64),
  courseId: z.string().uuid().optional().nullable(),
  referrer: z.string().trim().max(500).optional().nullable(),
})

/** The host alone. A full referring URL can itself carry personal detail. */
function hostOf(referrer?: string | null): string | null {
  if (!referrer) return null
  try {
    return new URL(referrer).hostname || null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  let parsed
  try {
    parsed = Body.safeParse(await req.json())
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  // A malformed beacon is not worth an error page. It is a counter.
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 })

  const limit = await rateLimit(`marketing_visit:${clientIp(req)}`, 120, 3600, 3600)
  if (!limit.allowed) {
    // Quietly, with no detail: inflating a colleague's figures should not be
    // made easier by telling the caller where the ceiling is.
    return NextResponse.json({ ok: true })
  }

  await recordVisit({
    marketerCode: parsed.data.code,
    sessionId: parsed.data.session,
    courseId: parsed.data.courseId ?? null,
    referrerHost: hostOf(parsed.data.referrer),
  })

  return NextResponse.json({ ok: true })
}

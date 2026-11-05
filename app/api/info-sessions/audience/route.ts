import { NextRequest, NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { resolveAudience, audienceOptions } from '@/lib/leads/audienceQuery'
import { describeFilter, type AudienceFilter } from '@/lib/leads/audienceFilter'

export const runtime = 'nodejs'
export const maxDuration = 30

const PORTALS = ['grp_automation']

/** What a filter can offer, read from the leads themselves. */
export const GET = withGuard({ portals: PORTALS }, async () => {
  const options = await audienceOptions()
  if ('error' in options) return NextResponse.json(options, { status: 503 })
  return NextResponse.json({ success: true, ...options })
})

/**
 * How many leads a selection matches — counted against every lead, not the
 * page the browser happens to be holding.
 *
 * Returns a sample rather than the whole audience: the screen needs to show
 * who it would reach, and five thousand names is not a preview.
 */
export const POST = withGuard({ portals: PORTALS }, async (req: NextRequest) => {
  const filter = (await req.json().catch(() => ({}))) as AudienceFilter
  const resolved = await resolveAudience(filter)
  if ('error' in resolved) return NextResponse.json(resolved, { status: 503 })

  return NextResponse.json({
    success: true,
    matching: resolved.matching,
    sendable: resolved.sendable.length,
    excluded: resolved.excluded.length,
    conditions: describeFilter(filter),
    /** The first forty, for the operator to look over before committing. */
    sample: resolved.sendable.slice(0, 40).map(l => ({
      id: l.id, full_name: l.full_name, phone: l.phone,
      status: l.status, source: l.source, course_interest: l.course_interest,
      industry: l.industry, created_at: l.created_at,
    })),
    /** And everybody who cannot be texted, with the reason. */
    excludedSample: resolved.excluded.slice(0, 40).map(l => ({
      id: l.id, full_name: l.full_name, phone: l.phone, reason: l.reason,
    })),
  })
})

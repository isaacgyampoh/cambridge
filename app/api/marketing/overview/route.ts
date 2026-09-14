import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireSession, GuardError } from '@/lib/auth/guard'
import { lookup } from '@/lib/db/lookup'
import { visitsByCode } from '@/lib/marketing/visits'

export const runtime = 'nodejs'

/**
 * Marketing links across the staff, for an administrator.
 *
 * ── WHY THIS IS NOT AN ANALYTICS PRODUCT ───────────────────────────────────
 *
 * Four numbers per person, inside the ERP, from the records the ERP already
 * keeps. The question an administrator actually has is "whose links are
 * working and whose are not", and that is answerable with opens, leads and
 * registrations side by side.
 *
 * Gated on the `marketers` portal — the same permission that already governs
 * the marketer performance screen this appears on. Not a new access rule.
 */
export async function GET(req: NextRequest) {
  // The guard is the point; nothing from it is needed afterwards, because
  // this endpoint is deliberately not scoped to the caller — an administrator
  // is asking about the whole team.
  try {
    await requireSession(req, { portals: ['marketers'] })
  } catch (e) {
    return (e as GuardError).response
  }

  const sb = createServiceClient()

  const { row: staff, failed } = await lookup(
    sb.from('profiles')
      .select('full_name, marketer_code')
      .not('marketer_code', 'is', null)
      .eq('is_active', true)
      .order('full_name'),
  )
  if (failed) {
    console.error('[marketing/overview] staff read failed:', failed)
    return NextResponse.json(
      { error: 'We could not load marketing performance just now. Please try again in a moment.' },
      { status: 503 },
    )
  }

  const visits = await visitsByCode()
  const visitsBy = new Map((visits || []).map(v => [v.code, v.visits]))

  /*
   * Leads per link in one read rather than one read per member of staff.
   *
   * The marketer performance screen beside this one issues a query per person
   * and is noticeably slow on a full staff list; there was no reason to
   * repeat that here.
   */
  const { data: leadRows } = await sb.from('leads')
    .select('utm_content')
    .eq('utm_source', 'marketing_link')
    .not('utm_content', 'is', null)
    .limit(20_000)

  const leadsBy = new Map<string, number>()
  for (const r of leadRows || []) {
    const code = String((r as { utm_content?: string }).utm_content || '')
    if (code) leadsBy.set(code, (leadsBy.get(code) || 0) + 1)
  }

  const rows = ((staff || []) as Array<{ full_name: string; marketer_code: string }>)
    .map(p => ({
      name: p.full_name,
      code: p.marketer_code,
      // Null, not zero, when nothing is being counted — so the screen can say
      // which it is instead of implying nobody opened anything.
      visits: visits === null ? null : (visitsBy.get(p.marketer_code) || 0),
      leads: leadsBy.get(p.marketer_code) || 0,
    }))
    .sort((a, b) => (b.leads - a.leads) || ((b.visits ?? 0) - (a.visits ?? 0)))

  return NextResponse.json({ rows, countingVisits: visits !== null })
}

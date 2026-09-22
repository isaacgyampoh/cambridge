import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { assignBacklog } from '@/lib/leads/backlog'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * The safety net under live assignment. Scheduler only.
 *
 * A lead is assigned the moment it arrives. This exists because twice that
 * path has failed in production for days without anybody noticing, and the
 * leads simply sat unowned. Whatever the cause next time, anything left
 * unassigned for more than a few minutes is now picked up by the fan-out —
 * which runs on the daily schedule and also whenever anybody opens a
 * dashboard — and distributed by the configured percentages.
 *
 * Leads younger than five minutes are left alone, because the live path is
 * still handling them.
 */
export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const result = await assignBacklog({ respectToggle: true, minAgeMinutes: 5, budgetMs: 45_000 })
  if (!result.ok) {
    console.error('[lead sweep]', result.reason)
    return NextResponse.json({ error: result.reason }, { status: 503 })
  }
  if (result.failed) console.error('[lead sweep] could not assign', result.failed, 'lead(s):', result.reasons)
  return NextResponse.json({ success: true, ...result })
}

import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { recalcTiers } from '@/lib/recalcTiers'
import { SECRETS } from '@/lib/config.server'

export const runtime = 'nodejs'

/** Cron (weekly): /api/tiers/recalc?key=SETUP_SECRET — auto-moves people
 *  between high/mid/low based on the last 30 days of conversions. */
export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get('key')
  if (!isValidCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await recalcTiers()
  return NextResponse.json({ ran: true, ...result })
}

import { NextRequest, NextResponse } from 'next/server'
import { recalcTiers } from '@/lib/recalcTiers'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/** Cron (weekly): /api/tiers/recalc?key=SETUP_SECRET — auto-moves people
 *  between high/mid/low based on the last 30 days of conversions. */
export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get('key')
  if (key !== CONFIG.setupSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await recalcTiers()
  return NextResponse.json({ ran: true, ...result })
}

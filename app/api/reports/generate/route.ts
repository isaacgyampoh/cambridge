import { NextRequest, NextResponse } from 'next/server'
import { generateReports } from '@/lib/generateReports'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/** Cron: /api/reports/generate?key=SECRET&period=daily|weekly|monthly */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  if (url.searchParams.get('key') !== CONFIG.setupSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const period = (url.searchParams.get('period') || 'daily') as 'daily' | 'weekly' | 'monthly'
  const result = await generateReports(period)
  return NextResponse.json({ ran: true, period, ...result })
}

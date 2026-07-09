import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { generateReports } from '@/lib/generateReports'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'project_manager']

/** PM/admin generates reports on demand (no need to wait for the cron). */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const { period } = await req.json()
  const p = ['daily', 'weekly', 'monthly'].includes(period) ? period : 'weekly'
  const result = await generateReports(p)
  return NextResponse.json({ success: true, ...result })
}

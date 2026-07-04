import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'project_manager', 'marketing_officer']

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { data: codes } = await sb.from('referral_codes').select('*').order('referrals_count', { ascending: false }).limit(200)

  // Count how many referred leads actually registered, per code
  const { data: refLeads } = await sb.from('leads').select('referral_code, status').eq('source', 'referral').limit(5000)
  const enrolledByCode: Record<string, number> = {}
  for (const l of refLeads || []) {
    if (l.referral_code && l.status === 'registered') enrolledByCode[l.referral_code] = (enrolledByCode[l.referral_code] || 0) + 1
  }

  const rows = (codes || []).map((c: any) => ({
    ...c, enrolled: enrolledByCode[c.code] || 0,
  }))

  const totalReferred = (refLeads || []).length
  const totalEnrolled = Object.values(enrolledByCode).reduce((a, b) => a + b, 0)

  return NextResponse.json({ codes: rows, totalReferred, totalEnrolled, totalReferrers: rows.length })
}

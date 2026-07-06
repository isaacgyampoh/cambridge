import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const period = new URL(req.url).searchParams.get('period') || 'weekly'
  const sb = createServiceClient()
  const oversight = ['super_admin', 'project_manager'].includes(s.role)

  let q = sb.from('marketer_reports')
    .select('*, profiles:marketer_id(full_name)')
    .eq('period', period)
    .order('period_start', { ascending: false })
    .limit(oversight ? 200 : 30)
  if (!oversight) q = q.eq('marketer_id', s.userId)

  const { data } = await q
  return NextResponse.json({ reports: (data || []).map((r: any) => ({ ...r, marketer_name: r.profiles?.full_name })) })
}

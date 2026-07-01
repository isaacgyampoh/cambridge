import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const [{ data: adm }, { data: apps }] = await Promise.all([
    sb.from('admissions').select('status, created_at').limit(5000),
    sb.from('applications').select('payment_status, created_at').limit(5000),
  ])
  const all = adm || []
  const pending = all.filter((a: any) => a.status === 'pending').length
  const awaiting = all.filter((a: any) => a.status === 'awaiting_payment' || a.status === 'awaiting_forms').length
  const admitted = all.filter((a: any) => a.status === 'admitted').length
  const newThisWeek = all.filter((a: any) => new Date(a.created_at).getTime() > Date.now() - 7 * 864e5).length

  const applications = apps || []
  const unpaidApps = applications.filter((a: any) => a.payment_status !== 'paid').length

  return NextResponse.json({
    total: all.length, pending, awaiting, admitted, newThisWeek,
    totalApplications: applications.length, unpaidApps,
  })
}

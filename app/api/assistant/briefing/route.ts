import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const OVERSIGHT = ['super_admin', 'project_manager']
const FINANCE = ['super_admin', 'project_manager', 'accountant']

/**
 * Proactive briefing: a few role-relevant alerts shown when the user opens
 * Gyampoh AI — so it surfaces problems before they go looking.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const role = session.role
  const alerts: string[] = []

  try {
    // Cold leads (everyone — own for non-oversight)
    const cutoff = new Date(Date.now() - 5 * 864e5).toISOString()
    let cq = sb.from('leads').select('id', { count: 'exact', head: true })
      .lt('updated_at', cutoff).not('status', 'in', '(registered,lost,not_interested)')
    if (!OVERSIGHT.includes(role)) cq = cq.eq('assigned_to', session.userId)
    const { count: cold } = await cq
    if (cold && cold > 0) alerts.push(`${cold} lead${cold > 1 ? 's have' : ' has'} gone quiet for 5+ days and need follow-up.`)

    // Unassigned leads (oversight only)
    if (OVERSIGHT.includes(role)) {
      const { count: unassigned } = await sb.from('leads').select('id', { count: 'exact', head: true }).is('assigned_to', null)
      if (unassigned && unassigned > 0) alerts.push(`${unassigned} new lead${unassigned > 1 ? 's are' : ' is'} unassigned.`)
    }

    // Overdue fees (finance)
    if (FINANCE.includes(role)) {
      const { data: fees } = await sb.from('student_fees').select('total_fee, amount_paid').limit(2000)
      const owing = (fees || []).filter((f: any) => Number(f.total_fee || 0) - Number(f.amount_paid || 0) > 0.01)
      const total = owing.reduce((s: number, f: any) => s + (Number(f.total_fee || 0) - Number(f.amount_paid || 0)), 0)
      if (owing.length) alerts.push(`${owing.length} student${owing.length > 1 ? 's owe' : ' owes'} a total of GHS ${total.toFixed(2)}.`)
    }
  } catch {}

  return NextResponse.json({ alerts: alerts.slice(0, 4) })
}

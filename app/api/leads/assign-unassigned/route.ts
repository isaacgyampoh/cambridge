import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { autoAssignLead } from '@/lib/autoAssign'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'project_manager']

/**
 * GET  -> diagnostic: how many unassigned leads + who's in the pool.
 * POST -> assign every unassigned lead via the weighted lottery.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { count: unassigned } = await sb.from('leads').select('id', { count: 'exact', head: true }).is('assigned_to', null)

  const { data: staff } = await sb.from('profiles')
    .select('id, full_name, role, is_active, in_lead_pool')
    .neq('role', 'super_admin').eq('is_active', true)
  const pool = (staff || []).filter((m: any) => m.in_lead_pool !== false)

  return NextResponse.json({
    unassigned: unassigned || 0,
    poolSize: pool.length,
    pool: pool.map((m: any) => ({ name: m.full_name, role: m.role })),
    reason: pool.length === 0
      ? 'No one is in the lead pool. Add at least one active marketer (or toggle "in lead pool" on a staff member).'
      : null,
  })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { data: leads } = await sb.from('leads').select('id').is('assigned_to', null).limit(1000)
  if (!leads?.length) return NextResponse.json({ success: true, assigned: 0, message: 'No unassigned leads.' })

  let assigned = 0, failed = 0
  for (const l of leads) {
    try {
      const who = await autoAssignLead(l.id)
      if (who) assigned++; else failed++
    } catch { failed++ }
  }

  return NextResponse.json({ success: true, assigned, failed, total: leads.length })
}

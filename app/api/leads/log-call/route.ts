import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Log that a staff member called a lead (tap-to-call auto-logging).
 * Records a 'call' activity and moves a brand-new lead to 'contacted'.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { lead_id } = await req.json()
  if (!lead_id) return NextResponse.json({ error: 'Missing lead' }, { status: 400 })

  const sb = createServiceClient()

  // Confirm the lead exists (and, for non-oversight, that it's theirs)
  const { data: lead } = await sb.from('leads').select('id, status, assigned_to').eq('id', lead_id).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const oversight = ['super_admin', 'project_manager'].includes(session.role)
  if (!oversight && lead.assigned_to !== session.userId) {
    return NextResponse.json({ error: 'Not your lead' }, { status: 403 })
  }

  // Log the call activity
  try {
    await sb.from('lead_activities').insert({
      lead_id, activity_type: 'call',
      subject: 'Called lead',
      description: `${session.fullName || 'Staff'} called this lead from the system.`,
      created_by: session.userId,
    })
  } catch {}

  // Move a fresh lead to 'contacted' (don't downgrade further-along leads)
  let newStatus = lead.status
  if (lead.status === 'new') {
    newStatus = 'contacted'
    try {
      await sb.from('leads').update({ status: 'contacted', updated_at: new Date().toISOString() }).eq('id', lead_id)
      await sb.from('lead_status_logs').insert({
        lead_id, old_status: 'new', new_status: 'contacted', changed_by: session.userId,
      })
    } catch {}
  } else {
    // Just bump updated_at so it doesn't look stale
    try { await sb.from('leads').update({ updated_at: new Date().toISOString() }).eq('id', lead_id) } catch {}
  }

  return NextResponse.json({ success: true, status: newStatus })
}

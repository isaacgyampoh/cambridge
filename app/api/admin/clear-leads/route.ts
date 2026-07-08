import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Permanently delete ALL leads (and their related rows) so a fresh import can
 * be done. Super admin only, and requires the exact confirmation phrase.
 * Students, staff, courses, classes etc. are NOT touched.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Only a super admin can clear leads.' }, { status: 403 })
  }
  const { confirm } = await req.json()
  if (confirm !== 'DELETE ALL LEADS') {
    return NextResponse.json({ error: 'Confirmation text did not match.' }, { status: 400 })
  }

  const sb = createServiceClient()

  // Count first (for the report)
  const { count: before } = await sb.from('leads').select('id', { count: 'exact', head: true })

  // Clear child tables that reference leads (some lack ON DELETE CASCADE).
  // Best-effort: ignore tables that don't exist on this instance.
  const childTables = [
    'lead_activities', 'lead_status_logs', 'ai_conversations',
    'sequence_enrollments', 'lead_assign_pending',
  ]
  // Delete-all requires a WHERE clause in Supabase; use a always-true filter.
  await Promise.allSettled(
    childTables.map(t => sb.from(t).delete().not('id', 'is', null))
  )
  // lead_assign_pending is keyed by marketer_id, not id — clear separately
  await sb.from('lead_assign_pending').delete().not('marketer_id', 'is', null).then(() => {}, () => {})

  // Now delete the leads themselves
  const { error } = await sb.from('leads').delete().not('id', 'is', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, deleted: before || 0 })
}

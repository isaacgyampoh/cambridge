import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Permanently delete a staff member. Guardrails:
 *  - only a super_admin can delete
 *  - never delete a super_admin
 *  - never delete yourself
 *  - their assigned leads are unassigned (not deleted) so no lead is lost
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Only a super admin can delete staff.' }, { status: 403 })
  }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing staff id.' }, { status: 400 })
  if (id === session.userId) return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })

  const sb = createServiceClient()
  const { data: target } = await sb.from('profiles').select('id, role, full_name').eq('id', id).maybeSingle()
  if (!target) return NextResponse.json({ error: 'Staff not found.' }, { status: 404 })
  if (target.role === 'super_admin') return NextResponse.json({ error: 'A super admin cannot be deleted.' }, { status: 400 })

  // Preserve leads: unassign anything owned by this person so no lead is lost.
  await sb.from('leads').update({ assigned_to: null }).eq('assigned_to', id)
  // Clear references from other tables that would block the delete via FK.
  // Each wrapped so a missing table/column never aborts the whole operation.
  const clears = [
    sb.from('profiles').update({ reports_to: null }).eq('reports_to', id),
    sb.from('leads').update({ created_by: null }).eq('created_by', id),
  ]
  await Promise.allSettled(clears.map(c => Promise.resolve(c)))

  // Delete rows this person owns in child tables (best-effort; ignore if the
  // table doesn't exist on this instance).
  const childTables = ['flyers', 'lead_assign_pending', 'marketer_reports', 'staff_messages', 'notifications', 'staff_attendance']
  await Promise.allSettled(childTables.flatMap(t => [
    sb.from(t).delete().eq('marketer_id', id),
    sb.from(t).delete().eq('user_id', id),
    sb.from(t).delete().eq('sender_id', id),
    sb.from(t).delete().eq('recipient_id', id),
    sb.from(t).delete().eq('staff_id', id),
  ]))

  const { error } = await sb.from('profiles').delete().eq('id', id)
  if (error) return NextResponse.json({ error: `Could not delete: ${error.message}. This person may still be linked to records — deactivate them instead.` }, { status: 500 })

  // Remove the auth login too, so the email/phone frees up for reuse.
  try { await sb.auth.admin.deleteUser(id) } catch {}

  return NextResponse.json({ success: true, deleted: target.full_name })
}

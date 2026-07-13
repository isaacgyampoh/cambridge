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

  // Null out every nullable reference to this profile across the schema, then
  // delete rows they own in child tables. Best-effort: a missing table/column
  // is ignored so it never aborts the whole operation.
  const nullRefs: Array<[string, string]> = [
    ['profiles', 'reports_to'], ['profiles', 'created_by'],
    ['leads', 'created_by'], ['leads', 'assigned_by'], ['leads', 'transferred_from'], ['leads', 'transferred_to'],
    ['lead_activities', 'created_by'], ['lead_comments', 'author_id'],
    ['admissions', 'processed_by'], ['admissions', 'assigned_to'],
    ['student_fees', 'recorded_by'], ['documents', 'uploaded_by'],
    ['info_sessions', 'created_by'], ['info_session_joins', 'marketer_id'],
    ['class_reminders', 'created_by'], ['broadcasts', 'created_by'],
    ['referral_codes', 'referrer_profile_id'], ['content_calendar', 'created_by'],
    ['competitors', 'added_by'], ['ai_conversations', 'marketer_id'],
    ['shared_links', 'posted_by'],
  ]
  await Promise.allSettled(nullRefs.map(([t, col]) =>
    Promise.resolve(sb.from(t).update({ [col]: null }).eq(col, id))
  ))

  // Delete rows this person exclusively owns in child tables.
  const ownedDeletes: Array<[string, string]> = [
    ['flyers', 'marketer_id'], ['lead_assign_pending', 'marketer_id'],
    ['marketer_reports', 'marketer_id'], ['marketer_enrollments', 'marketer_id'],
    ['staff_messages', 'sender_id'], ['staff_messages', 'recipient_id'],
    ['notifications', 'user_id'], ['staff_attendance', 'staff_id'],
    ['login_events', 'user_id'],
  ]
  await Promise.allSettled(ownedDeletes.map(([t, col]) =>
    Promise.resolve(sb.from(t).delete().eq(col, id))
  ))

  const { error } = await sb.from('profiles').delete().eq('id', id)
  if (error) return NextResponse.json({ error: `Could not delete: ${error.message}. This person may still be linked to records — deactivate them instead.` }, { status: 500 })

  // Remove the auth login too, so the email/phone frees up for reuse.
  try { await sb.auth.admin.deleteUser(id) } catch {}

  return NextResponse.json({ success: true, deleted: target.full_name })
}

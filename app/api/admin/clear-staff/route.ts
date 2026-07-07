import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * One-time cleanup: delete ALL non-super-admin staff, leaving only super
 * admins. Used to clear test/seed staff before real onboarding.
 * Requires: super_admin session + explicit confirm flag. Leads owned by the
 * removed staff are unassigned (kept), not deleted.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Only a super admin can do this.' }, { status: 403 })
  }
  const { confirm } = await req.json()
  if (confirm !== 'DELETE ALL STAFF') {
    return NextResponse.json({ error: 'Confirmation text did not match.' }, { status: 400 })
  }

  const sb = createServiceClient()
  // Everyone who is NOT a super admin
  const { data: toRemove } = await sb.from('profiles').select('id').neq('role', 'super_admin')
  const ids = (toRemove || []).map((p: any) => p.id)
  if (ids.length === 0) return NextResponse.json({ success: true, removed: 0 })

  // Preserve leads and clear hierarchy pointers
  await sb.from('leads').update({ assigned_to: null }).in('assigned_to', ids)
  await sb.from('profiles').update({ reports_to: null }).in('reports_to', ids)
  await sb.from('leads').update({ created_by: null }).in('created_by', ids)

  // Best-effort clear of child-table rows that would block deletes
  const childTables = ['flyers', 'lead_assign_pending', 'marketer_reports', 'staff_messages', 'notifications', 'staff_attendance']
  await Promise.allSettled(childTables.flatMap(t => [
    sb.from(t).delete().in('marketer_id', ids),
    sb.from(t).delete().in('user_id', ids),
    sb.from(t).delete().in('sender_id', ids),
    sb.from(t).delete().in('recipient_id', ids),
    sb.from(t).delete().in('staff_id', ids),
  ]))

  const { error } = await sb.from('profiles').delete().in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Free up the auth logins too
  await Promise.allSettled(ids.map((uid: string) => sb.auth.admin.deleteUser(uid)))

  return NextResponse.json({ success: true, removed: ids.length })
}

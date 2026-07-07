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
  // Clear any hierarchy pointers to them
  await sb.from('profiles').update({ reports_to: null }).eq('reports_to', id)

  const { error } = await sb.from('profiles').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, deleted: target.full_name })
}

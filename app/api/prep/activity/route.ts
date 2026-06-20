import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * Coordinator activity feed — every comment/change exam-prep coordinators
 * make. Visible to the project manager and admin (full oversight).
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !['super_admin', 'project_manager'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const sb = createServiceClient()
  const url = new URL(req.url)
  const program = url.searchParams.get('program')
  let q = sb.from('prep_activity').select('*').order('created_at', { ascending: false }).limit(200)
  if (program) q = q.eq('program_code', program)
  const { data } = await q
  return NextResponse.json({ activity: data || [] })
}

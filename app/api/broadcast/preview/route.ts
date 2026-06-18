import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !['super_admin', 'project_manager'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const { target_type, target_filters } = await req.json()
  const sb = createServiceClient()

  const queries: Record<string, any> = {
    all_leads: sb.from('leads').select('full_name', { count: 'exact' }).not('phone', 'is', null),
    leads_by_status: sb.from('leads').select('full_name', { count: 'exact' }).eq('status', target_filters?.status || 'new').not('phone', 'is', null),
    leads_by_source: sb.from('leads').select('full_name', { count: 'exact' }).eq('source', target_filters?.source || 'facebook').not('phone', 'is', null),
    all_students: sb.from('profiles').select('full_name', { count: 'exact' }).eq('role', 'student').eq('is_active', true).not('phone', 'is', null),
    interested_not_converted: sb.from('leads').select('full_name', { count: 'exact' }).in('status', ['interested', 'follow_up']).not('phone', 'is', null),
    uncontacted_leads: sb.from('leads').select('full_name', { count: 'exact' }).eq('status', 'new').is('assigned_to', null).not('phone', 'is', null),
  }

  const q = queries[target_type]
  if (!q) return NextResponse.json({ count: 0, names: [] })

  const { data, count } = await q.limit(5)
  return NextResponse.json({ count: count || 0, names: (data || []).map((r: any) => r.full_name) })
}

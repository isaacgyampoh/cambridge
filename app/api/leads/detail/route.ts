import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Robust single-lead fetch for the detail page. Any staff member can open a
 * lead they own (assigned_to them) or created; oversight roles can open any.
 * This replaces the generic /api/data query that 403'd for some roles and
 * caused a false "Lead not found" (the reported 404).
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const sb = createServiceClient()
  const { data: lead } = await sb.from('leads')
    .select('*, assignee:assigned_to(full_name)')
    .eq('id', id).maybeSingle()

  if (!lead) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Access: oversight roles see any; everyone else only their own lead.
  const oversight = ['super_admin', 'administrator', 'project_manager', 'accountant', 'admissions_officer'].includes(s.role || '')
  const owns = lead.assigned_to === s.userId || lead.created_by === s.userId
  if (!oversight && !owns) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Activities + comments in one go
  const [{ data: activities }, { data: comments }] = await Promise.all([
    sb.from('lead_activities').select('*, creator:created_by(full_name)').eq('lead_id', id).order('created_at', { ascending: false }).limit(50),
    sb.from('lead_comments').select('*, author:author_id(full_name)').eq('lead_id', id).order('created_at', { ascending: false }).limit(50).then(r => r, () => ({ data: [] })),
  ])

  return NextResponse.json({ lead, activities: activities || [], comments: comments || [] })
}

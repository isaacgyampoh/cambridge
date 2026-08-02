import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager']

/**
 * Repair chat attribution. Conversations store the marketer as at the moment
 * they happened, so anything sent before a lead was assigned — or before that
 * marketer's own WhatsApp line was connected — is stuck against the central
 * line. This rewrites those rows to the lead's current owner.
 * GET = how many would change. POST = do it.
 */
async function scan(sb: any) {
  const { data: rows } = await sb.from('ai_conversations')
    .select('id, lead_id, marketer_id').is('marketer_id', null).not('lead_id', 'is', null).limit(5000)

  const leadIds = Array.from(new Set((rows || []).map((r: any) => r.lead_id)))
  if (!leadIds.length) return { candidates: 0, fixable: 0, updates: [] as any[] }

  const owner: Record<string, string> = {}
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data: leads } = await sb.from('leads')
      .select('id, assigned_to').in('id', leadIds.slice(i, i + 200))
    for (const l of leads || []) if (l.assigned_to) owner[l.id] = l.assigned_to
  }

  const updates = (rows || [])
    .filter((r: any) => owner[r.lead_id])
    .map((r: any) => ({ id: r.id, marketer_id: owner[r.lead_id] }))

  return { candidates: (rows || []).length, fixable: updates.length, updates }
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const { updates, ...summary } = await scan(createServiceClient())
  return NextResponse.json({ dryRun: true, ...summary })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { updates, ...summary } = await scan(sb)
  let fixed = 0
  for (const u of updates) {
    const { error } = await sb.from('ai_conversations').update({ marketer_id: u.marketer_id }).eq('id', u.id)
    if (!error) fixed++
  }
  return NextResponse.json({ success: true, ...summary, fixed })
}

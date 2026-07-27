import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator']

/** GET = dry run (what would go / stay). POST = actually delete. */
async function plan(sb: any) {
  const { data: leads } = await sb.from('leads').select('id, status').limit(10000)
  const all = leads || []
  const byStatus: Record<string, number> = {}
  for (const l of all) byStatus[l.status || 'null'] = (byStatus[l.status || 'null'] || 0) + 1

  // Protect anyone genuinely registered, even if their status is wrong:
  // they have an admission record or a paid application.
  const { data: adm } = await sb.from('admissions').select('lead_id').limit(10000)
  const { data: paidApps } = await sb.from('applications').select('lead_id').eq('payment_status', 'paid').limit(10000)
  const protectedIds = new Set<string>()
  for (const a of adm || []) if (a.lead_id) protectedIds.add(a.lead_id)
  for (const a of paidApps || []) if (a.lead_id) protectedIds.add(a.lead_id)

  const doomed = all.filter((l: any) => l.status !== 'registered' && !protectedIds.has(l.id)).map((l: any) => l.id)
  return { total: all.length, byStatus, protected: protectedIds.size, toDelete: doomed.length, doomed }
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const { doomed, ...summary } = await plan(createServiceClient())
  return NextResponse.json({ dryRun: true, ...summary })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { doomed, ...summary } = await plan(sb)
  const child: [string, string][] = [
    ['lead_activities', 'lead_id'], ['lead_comments', 'lead_id'], ['ai_conversations', 'lead_id'],
    ['lead_assign_pending', 'lead_id'], ['follow_up_queue', 'lead_id'], ['sequence_enrollments', 'lead_id'],
    ['lead_status_logs', 'lead_id'], ['info_session_joins', 'lead_id'],
  ]

  let deleted = 0
  for (let i = 0; i < doomed.length; i += 100) {
    const chunk = doomed.slice(i, i + 100)
    // clear dependants first so FKs can't block the delete
    await Promise.allSettled(child.map(([t, col]) => Promise.resolve(sb.from(t).delete().in(col, chunk))))
    await sb.from('applications').update({ lead_id: null }).in('lead_id', chunk).then(() => {}, () => {})
    const { error } = await sb.from('leads').delete().in('id', chunk)
    if (!error) deleted += chunk.length
    else console.error('[purge-leads]', error.message)
  }

  const after = await plan(sb)
  return NextResponse.json({ success: true, ...summary, deleted, remaining: after.total, remainingByStatus: after.byStatus })
}

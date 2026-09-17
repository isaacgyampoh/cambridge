import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { unavailable } from '@/lib/db/lookup'

export const runtime = 'nodejs'

/**
 * Why every lead went where it went.
 *
 * This is the view that settles "I never got that lead". For any recent
 * assignment it shows who it went to, what weight decided it, which method
 * chose them, what the lead came in from, and whether the notification
 * actually left the building — so the answer is one of a known set:
 *
 *   assigned to them and notified      -> it is on their leads page
 *   assigned to them, notify failed    -> it is on their page, unannounced
 *   assigned to somebody else          -> the row names who and why
 *   never assigned                     -> it has no row at all, and the
 *                                         unassigned count on the dashboard
 *                                         is where it shows up
 *
 * rather than a shrug.
 */

const ALLOWED_ROLES = ['super_admin', 'project_manager']

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: { valid?: boolean; role?: string } =
    token ? await verifySession(token) : { valid: false }

  if (!session.valid || !ALLOWED_ROLES.includes(session.role || '')) {
    return NextResponse.json(
      { error: 'Only a super admin or project manager can view this.' },
      { status: 403 },
    )
  }

  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('limit') || '50', 10) || 50, 1), 200)
  const staffId = req.nextUrl.searchParams.get('staffId')

  const sb = createServiceClient()

  /*
   * Migration 0021's columns are named here, and PostgREST fails the whole
   * select when one is missing — which before the migration would show an
   * empty history and read as "no lead was ever distributed". The narrower
   * select is used instead until the columns exist.
   */
  const FULL = 'id, lead_id, to_marketer, from_marketer, reason, source, method, weight_at_assignment, pool_size, campaign, notified, notify_error, created_at'
  const BASE = 'id, lead_id, to_marketer, from_marketer, reason, source, created_at'

  function historyQuery(columns: string) {
    let q = sb.from('lead_assignments')
      .select(columns)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (staffId) q = q.eq('to_marketer', staffId)
    return q
  }

  type Row = Record<string, unknown>
  let rows: Row[] | null = null

  const full = await historyQuery(FULL)
  if (!full.error) {
    rows = full.data as unknown as Row[]
  } else if (full.error.code === '42703' || /column .* does not exist/.test(full.error.message)) {
    const base = await historyQuery(BASE)
    if (base.error) return unavailable('[distribution/history]', base.error.message, 'the allocation history')
    rows = base.data as unknown as Row[]
  } else {
    return unavailable('[distribution/history]', full.error.message, 'the allocation history')
  }

  /*
   * Names are resolved in two follow-up reads rather than a PostgREST embed.
   * lead_assignments has two separate foreign keys into profiles, and an
   * ambiguous embed on that table fails the whole select — which would show
   * an empty history and look exactly like "no leads were ever distributed".
   */
  const leadIds = [...new Set((rows || []).map(r => r.lead_id).filter(Boolean))] as string[]
  const staffIds = [...new Set([
    ...(rows || []).map(r => r.to_marketer),
    ...(rows || []).map(r => r.from_marketer),
  ].filter(Boolean))] as string[]

  const [leadsRes, staffRes] = await Promise.all([
    leadIds.length
      ? sb.from('leads').select('id, full_name, source').in('id', leadIds)
      : Promise.resolve({ data: [], error: null }),
    staffIds.length
      ? sb.from('profiles').select('id, full_name').in('id', staffIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (leadsRes.error) return unavailable('[distribution/history]', leadsRes.error.message, 'the leads in this history')
  if (staffRes.error) return unavailable('[distribution/history]', staffRes.error.message, 'the staff in this history')

  const leadById = new Map((leadsRes.data || []).map(l => [l.id, l]))
  const nameById = new Map((staffRes.data || []).map(p => [p.id, p.full_name]))

  return NextResponse.json({
    events: (rows || []).map(r => ({
      id: r.id,
      leadId: r.lead_id,
      leadName: leadById.get(r.lead_id as string)?.full_name || null,
      to: nameById.get(r.to_marketer as string) || null,
      toId: r.to_marketer,
      from: nameById.get(r.from_marketer as string) || null,
      reason: r.reason,
      method: r.method,
      weight: r.weight_at_assignment === null ? null : Number(r.weight_at_assignment),
      poolSize: r.pool_size,
      source: r.source || leadById.get(r.lead_id as string)?.source || null,
      campaign: r.campaign,
      notified: r.notified,
      notifyError: r.notify_error,
      at: r.created_at,
    })),
  })
}

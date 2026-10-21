import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { unavailable } from '@/lib/db/lookup'

export const runtime = 'nodejs'

/**
 * Who did what, and when.
 *
 * ── WHY THIS DID NOT EXIST ─────────────────────────────────────────────────
 *
 * recordAudit() writes to audit_logs from thirty-odd places — a lead created
 * by hand, a fee re-priced, a student registered manually, a provisioning
 * window opened. Eight hundred rows across thirty-two kinds of action, going
 * back to September.
 *
 * Nothing read them. No screen, no route, and no role may read the table
 * through /api/data either. The trail was written faithfully and was
 * invisible to the people it exists for, which is the same as not having one
 * — worse, because everybody believed there was a record.
 *
 * ── WHY NOT /api/admin ─────────────────────────────────────────────────────
 *
 * That prefix is SUPER_ADMIN_ONLY, checked before portals, so a route there
 * would have locked out the project manager — one of the two people who
 * asked for this. It is scoped to the `reports` portal instead: held by the
 * super admin, the administrator and the PM, and by neither the accountant
 * nor a trainer.
 */

const MAY_VIEW = ['super_admin', 'administrator', 'project_manager']

/** A page of history, not an export. */
const PAGE = 50
const MAX_PAGE = 200

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: { valid?: boolean; role?: string } = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !MAY_VIEW.includes(session.role || '')) {
    return NextResponse.json({ error: 'Only management can see the activity log.' }, { status: 403 })
  }

  const url = new URL(req.url)
  const page = Math.max(0, Number(url.searchParams.get('page') || 0) || 0)
  const size = Math.min(MAX_PAGE, Number(url.searchParams.get('size') || PAGE) || PAGE)
  const actor = url.searchParams.get('actor') || ''
  const action = url.searchParams.get('action') || ''
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''

  const sb = createServiceClient()

  let q = sb.from('audit_logs')
    .select('id, user_id, action, table_name, record_id, ip_address, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (actor) q = q.eq('user_id', actor)
  // Prefix, so 'student_fee' finds both reprice and reprice_bulk.
  if (action) q = q.like('action', `${action}%`)
  if (from) q = q.gte('created_at', `${from}T00:00:00.000Z`)
  // Half-open: the whole of the end day belongs to the range.
  if (to) q = q.lt('created_at', `${to}T23:59:59.999Z`)

  const { data: rows, error, count } = await q.range(page * size, page * size + size - 1)
  if (error) return unavailable('[activity-log]', error.message, 'the activity log')

  /*
   * Names, not ids. A log that reads "7e6a8f66-… reprice" is a log nobody
   * uses. Resolved in one query rather than per row.
   */
  const ids = Array.from(new Set((rows || []).map(r => r.user_id).filter(Boolean))) as string[]
  const names = new Map<string, { name: string; role: string }>()
  if (ids.length) {
    const { data: people } = await sb.from('profiles').select('id, full_name, role').in('id', ids)
    for (const p of people || []) {
      names.set(p.id as string, { name: (p.full_name as string) || 'Unnamed', role: String(p.role ?? '') })
    }
  }

  /*
   * `metadata` is deliberately NOT selected. It carries whatever each caller
   * chose to record — reasons, amounts, names — and some of it is about
   * students rather than staff. The list answers "who did what, when"; a
   * detail view is where the rest belongs, behind its own decision.
   */
  return NextResponse.json({
    total: count ?? 0,
    page,
    size,
    entries: (rows || []).map(r => ({
      id: r.id,
      at: r.created_at,
      action: r.action,
      resource: r.table_name,
      recordId: r.record_id,
      actor: r.user_id ? names.get(r.user_id as string)?.name ?? 'Removed account' : 'The system',
      actorRole: r.user_id ? names.get(r.user_id as string)?.role ?? null : null,
      ip: r.ip_address,
    })),
  })
}

/** The distinct actions present, so a filter can offer real values. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: { valid?: boolean; role?: string } = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !MAY_VIEW.includes(session.role || '')) {
    return NextResponse.json({ error: 'Only management can see the activity log.' }, { status: 403 })
  }
  const sb = createServiceClient()
  const { data } = await sb.from('audit_logs').select('action').limit(5000)
  const actions = Array.from(new Set((data || []).map(r => r.action as string))).sort()
  return NextResponse.json({ actions })
}

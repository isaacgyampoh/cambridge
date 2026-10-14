import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { unavailable } from '@/lib/db/lookup'
import {
  statsForMonth, statsAllTime, monthlySeries, recentMonths, monthKeyOf, monthLabel,
} from '@/lib/analytics/leadStats'

export const runtime = 'nodejs'

/**
 * What one member of staff received and converted, all time and by month.
 *
 * Anyone may ask about themselves. Only the roles that oversee the pipeline
 * may ask about somebody else — a marketer reading a colleague's conversion
 * rate is a performance conversation that belongs to a manager.
 */
const MAY_VIEW_OTHERS = ['super_admin', 'administrator', 'project_manager']

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: { valid?: boolean; role?: string; userId?: string } =
    token ? await verifySession(token) : { valid: false }
  if (!session.valid || !session.userId) {
    return NextResponse.json({ error: 'Please sign in to continue.' }, { status: 401 })
  }

  const url = new URL(req.url)
  const asked = url.searchParams.get('staffId')
  const subject = asked && asked !== session.userId ? asked : session.userId

  if (subject !== session.userId && !MAY_VIEW_OTHERS.includes(session.role || '')) {
    return NextResponse.json({ error: 'You can only see your own figures.' }, { status: 403 })
  }

  const now = new Date()
  const months = recentMonths(now, 12)
  const month = url.searchParams.get('month') || months[0]
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'That month is not valid.' }, { status: 400 })
  }

  const sb = createServiceClient()

  /*
   * Everything this person holds. assigned_at is selected — the dashboard it
   * replaces selected only created_at, which is why a month's figures counted
   * leads the person had not yet been given.
   */
  const { data: leads, error: leadsError } = await sb.from('leads')
    .select('id, status, assigned_at, created_at, follow_up_at')
    .eq('assigned_to', subject).limit(10000)
  if (leadsError) return unavailable('[staff/lead-stats]', leadsError.message, 'those leads')

  /*
   * When each of them converted. The admission is the dated record of a
   * registration; leads.status says that one happened but never when, and the
   * transition is not written to lead_status_logs by the registration path.
   */
  const ids = (leads || []).map(l => l.id)
  const byLead = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data: adm } = await sb.from('admissions')
      .select('lead_id, created_at').in('lead_id', ids.slice(i, i + 200))
    for (const a of adm || []) {
      const at = a.created_at as string | null
      const lid = a.lead_id as string | null
      if (!lid || !at) continue
      // The earliest admission is the conversion; a later one is a second course.
      const held = byLead.get(lid)
      if (!held || at < held) byLead.set(lid, at)
    }
  }

  const rows = (leads || []) as Parameters<typeof statsForMonth>[0]
  const selected = statsForMonth(rows, byLead, month, now)

  /*
   * The ids are returned so a screen can show the records behind a number
   * rather than asking somebody to trust it. Capped: this is a figure with a
   * drill-down, not a lead export.
   */
  const CAP = 200

  return NextResponse.json({
    staffId: subject,
    isSelf: subject === session.userId,
    allTime: statsAllTime(rows, byLead),
    month: {
      key: month,
      label: monthLabel(month),
      ...selected,
      receivedIds: selected.receivedIds.slice(0, CAP),
      convertedIds: selected.convertedIds.slice(0, CAP),
    },
    months: monthlySeries(rows, byLead, months, now),
    /*
     * Said plainly: leads with no assigned_at belong to no month, so the
     * monthly figures will not sum to the all-time one. Better stated than
     * discovered.
     */
    note: statsAllTime(rows, byLead).undated > 0
      ? `${statsAllTime(rows, byLead).undated} of these have no date of receipt, so they appear in no month.`
      : null,
    generatedAt: new Date().toISOString(),
    thisMonth: monthKeyOf(now.toISOString()),
  })
}

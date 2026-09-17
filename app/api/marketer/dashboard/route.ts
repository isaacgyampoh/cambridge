import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { readQuota } from '@/lib/leads/quota'

export const runtime = 'nodejs'

/** Personal dashboard stats for the logged-in marketer (or any staff who markets). */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const me = session.userId
  const year = new Date().getFullYear()

  const [leadsRes, enrollRes, quotaRes] = await Promise.all([
    sb.from('leads').select('status, created_at, updated_at').eq('assigned_to', me).limit(5000),
    sb.from('marketer_enrollments').select('points, registration_fee, created_at').eq('marketer_id', me).eq('year', year).limit(5000),
    readQuota(me),
  ])

  /*
   * A FAILED READ IS NOT AN EMPTY PIPELINE.
   *
   * Both errors used to be discarded, so a database blip rendered as a
   * marketer with no leads, no registrations and no commission — a screen
   * that says somebody has done nothing all year is worse than a screen that
   * says it could not load.
   */
  if (leadsRes.error) {
    console.error('[marketer/dashboard] leads unreadable:', leadsRes.error.message)
    return NextResponse.json(
      { error: 'We could not load your figures just now. Please try again in a moment.' },
      { status: 503 },
    )
  }
  if (enrollRes.error) {
    console.error('[marketer/dashboard] enrolments unreadable:', enrollRes.error.message)
    return NextResponse.json(
      { error: 'We could not load your figures just now. Please try again in a moment.' },
      { status: 503 },
    )
  }

  const leads = leadsRes.data
  const enroll = enrollRes.data
  const all = leads || []
  const totalLeads = all.length
  const registered = all.filter((l: any) => l.status === 'registered').length
  const contacted = all.filter((l: any) => ['contacted', 'interested', 'follow_up', 'next_session'].includes(l.status)).length
  const newLeads = all.filter((l: any) => l.status === 'new').length

  // Cold: not updated in 5+ days and not closed
  const cutoff = Date.now() - 5 * 864e5
  const cold = all.filter((l: any) => !['registered', 'lost', 'not_interested', 'done'].includes(l.status) && new Date(l.updated_at).getTime() < cutoff).length

  const en = enroll || []
  const points = en.reduce((s: number, e: any) => s + Number(e.points || 0), 0)
  const regFees = en.reduce((s: number, e: any) => s + Number(e.registration_fee || 0), 0)

  // Leads added over the last 7 days (for a mini trend)
  const byDay: number[] = Array.from({ length: 7 }, (_, i) => {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0); dayStart.setDate(dayStart.getDate() - (6 - i))
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
    return all.filter((l: any) => { const t = new Date(l.created_at).getTime(); return t >= dayStart.getTime() && t < dayEnd.getTime() }).length
  })

  const conversionRate = totalLeads ? Math.round(registered / totalLeads * 100) : 0

  return NextResponse.json({
    totalLeads, registered, contacted, newLeads, cold,
    points, regFees, conversionRate, byDay,
    /*
     * Null when the quota itself could not be read. The screen says so rather
     * than showing a target of zero, which would read as a target somebody
     * had wiped.
     */
    quota: quotaRes.ok ? quotaRes.quota : null,
    quotaError: quotaRes.ok ? null : 'Your target could not be loaded.',
  })
}

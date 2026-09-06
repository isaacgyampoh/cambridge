import { NextRequest, NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Dashboard figures, counted in the database.
 *
 * The dashboard used to fetch 500 leads, 200 admissions, 500 payments and 200
 * profiles into the browser and count them in JavaScript — around 1,400 rows
 * over the wire on every load, to render eight numbers. At 181 leads that is
 * merely wasteful; at ten thousand it is a dashboard nobody waits for.
 *
 * Two of those four fetches were dead: `payments` was fetched and never read,
 * and the activity feed was fetched into state that nothing rendered.
 *
 * Everything here is a `count: 'exact', head: true` query, so the rows never
 * leave Postgres. A marketer sees their own figures; oversight roles see the
 * centre's.
 */

type Counts = { total: number; today: number; unassigned: number; readyToJoin: number }

export const GET = withGuard({}, async (req: NextRequest, { session, portals }) => {
  const sb = createServiceClient()

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const today = startOfToday.toISOString()

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString()

  /*
   * Whose numbers are these? Somebody who only has "my leads" must not be
   * shown the centre-wide total — it is not their figure, and it leaks the
   * size of the pipeline to someone scoped out of it.
   */
  const seesEverything = session.role === 'super_admin'
    || portals.includes('leads') || portals.includes('pm_leads')

  const scope = <T>(q: T): T => {
    if (seesEverything) return q
    return (q as { eq: (c: string, v: string) => T }).eq('assigned_to', session.userId)
  }

  const leadCount = (build: (q: ReturnType<typeof sb.from>) => unknown) =>
    build(sb.from('leads')) as unknown as Promise<{ count: number | null }>

  const [
    total, todayCount, unassigned, readyToJoin,
    thisWeek, lastWeek,
    admissionsTotal, admitted, activeStaff,
  ] = await Promise.all([
    leadCount(q => scope(q.select('id', { count: 'exact', head: true }))),
    leadCount(q => scope(q.select('id', { count: 'exact', head: true })).gte('created_at', today)),
    // "Unassigned" is a centre-wide queue; it means nothing scoped to one person.
    seesEverything
      ? leadCount(q => q.select('id', { count: 'exact', head: true }).is('assigned_to', null))
      : Promise.resolve({ count: 0 }),
    leadCount(q => scope(q.select('id', { count: 'exact', head: true })).eq('status', 'ready_to_join')),
    leadCount(q => scope(q.select('id', { count: 'exact', head: true })).gte('created_at', weekAgo)),
    leadCount(q => scope(q.select('id', { count: 'exact', head: true }))
      .gte('created_at', twoWeeksAgo).lt('created_at', weekAgo)),
    sb.from('admissions').select('id', { count: 'exact', head: true }),
    sb.from('admissions').select('id', { count: 'exact', head: true }).eq('status', 'admitted'),
    sb.from('profiles').select('id', { count: 'exact', head: true })
      .eq('is_active', true).neq('role', 'student'),
  ])

  const leads: Counts = {
    total: total.count || 0,
    today: todayCount.count || 0,
    unassigned: unassigned.count || 0,
    readyToJoin: readyToJoin.count || 0,
  }

  const week = thisWeek.count || 0
  const prior = lastWeek.count || 0
  // No prior week means no trend. Reporting "+100%" against zero is a fiction.
  const deltaPercent = prior > 0 ? Math.round(((week - prior) / prior) * 100) : null

  return NextResponse.json({
    scope: seesEverything ? 'centre' : 'mine',
    leads,
    trend: { thisWeek: week, lastWeek: prior, deltaPercent },
    admissions: { total: admissionsTotal.count || 0, admitted: admitted.count || 0 },
    staff: { active: activeStaff.count || 0 },
  })
})

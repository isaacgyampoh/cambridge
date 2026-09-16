import { NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { kickDueJobs } from '@/lib/cron/opportunistic'

export const runtime = 'nodejs'

/**
 * What this person needs to know, and do, right now.
 *
 * ── WHY THIS IS NOT A LIST OF TOTALS ───────────────────────────────────────
 *
 * The dashboard showed six figures: total leads, unassigned, ready to join,
 * admissions, admitted, active staff. Every one is true and none of them
 * answers the question somebody opens a dashboard to ask, which is "what
 * should I do first?". A total does not change between Monday and Friday in a
 * way that tells anyone anything; a count of follow-ups that were due
 * yesterday does.
 *
 * So the payload is in three parts:
 *
 *   today      — what has happened since this morning
 *   attention  — things that are WAITING on somebody, with somewhere to go
 *   activity   — what has actually been happening
 *
 * `attention` is built from what this person can act on. An accountant is not
 * shown unassigned leads, because assigning them is not their job and the
 * number is noise on their screen. Only non-zero items are returned: a
 * dashboard full of zeroes trains people to ignore it, and then the one that
 * is not zero is ignored too.
 *
 * Everything is counted in Postgres with `count: 'exact', head: true`, so the
 * rows never leave the database. The previous version pulled roughly 1,400
 * rows into the browser to render eight numbers, two of the four fetches being
 * dead code.
 */

/** One thing waiting on somebody, and where to go to deal with it. */
type Attention = {
  key: string
  label: string
  count: number
  href: string
  tone: 'danger' | 'warning' | 'accent'
  /** Why it matters, in the words the person would use. */
  hint: string
}

type ActivityItem = { id: string; at: string; text: string; href?: string }

/**
 * One person who is actually waiting to be called.
 *
 * The counts above say "6 follow-ups overdue", which is a number to go and
 * look at. This is the six people, by name, with the number to ring — so the
 * dashboard is somewhere work gets done rather than a signpost to a list.
 *
 * Capped at five deliberately. A dashboard is a prompt, not a worklist: the
 * full set lives on the follow-ups screen, and a home page that scrolls for a
 * minute is one nobody reads to the bottom of.
 */
type PriorityLead = {
  id: string
  name: string
  phone: string | null
  course: string | null
  /** When the follow-up was promised. Null when none was set. */
  dueAt: string | null
  overdue: boolean
  href: string
}

export const GET = withGuard({}, async (_req, { session, portals }) => {
  /*
   * Every staff member loads this when they open the portal, which makes it
   * the cheapest place to notice the job queue is due a drain.
   *
   * This plan allows a daily cron only, and a marketer should not hear about
   * Tuesday's lead on Wednesday. See lib/cron/opportunistic.ts — it is rate
   * limited, runs after the response, and cannot delay or fail this request.
   */
  kickDueJobs()

  const sb = createServiceClient()
  const role = session.role

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const today = startOfToday.toISOString()
  const now = new Date().toISOString()
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()

  const has = (...ids: string[]) => role === 'super_admin' || ids.some(p => portals.includes(p))

  /*
   * Whose numbers are these? Somebody who only holds "my leads" must not see
   * the centre-wide total — it is not their figure, and it discloses the size
   * of the pipeline to someone deliberately scoped out of it.
   */
  const seesEverything = role === 'super_admin' || has('leads', 'pm_leads')
  /*
   * Narrow a leads query to this person, unless they oversee everyone.
   *
   * Generic so the Supabase builder's own type survives the call and the
   * filters chained afterwards still typecheck — the whole point of doing this
   * in Postgres is lost if the query has to be cast to `any` to compose.
   */
  const mine = <T,>(q: T): T =>
    seesEverything ? q : (q as { eq: (c: string, v: string) => T }).eq('assigned_to', session.userId)

  const leads = () => sb.from('leads')
  const countOf = (p: unknown) => p as Promise<{ count: number | null }>

  /* ── today ─────────────────────────────────────────────────────────────── */

  const [newLeads, registeredToday, followUpsDue, followUpsOverdue] = await Promise.all([
    countOf(mine(leads().select('id', { count: 'exact', head: true })).gte('created_at', today)),
    countOf(mine(leads().select('id', { count: 'exact', head: true }))
      .eq('status', 'registered').gte('updated_at', today)),
    // Due today and not yet dealt with.
    countOf(mine(leads().select('id', { count: 'exact', head: true }))
      .gte('follow_up_at', today).lte('follow_up_at', now)),
    // Already late. Kept separate because it is a different conversation.
    countOf(mine(leads().select('id', { count: 'exact', head: true }))
      .lt('follow_up_at', today).not('follow_up_at', 'is', null)),
  ])

  /* ── the pipeline, for context rather than as the headline ─────────────── */

  const [total, readyToJoin, unassigned] = await Promise.all([
    countOf(mine(leads().select('id', { count: 'exact', head: true }))),
    countOf(mine(leads().select('id', { count: 'exact', head: true })).eq('status', 'ready_to_join')),
    seesEverything
      ? countOf(leads().select('id', { count: 'exact', head: true }).is('assigned_to', null))
      : Promise.resolve({ count: 0 }),
  ])

  /* ── what is waiting on somebody ───────────────────────────────────────── */

  const attention: Attention[] = []
  const push = (a: Attention) => { if (a.count > 0) attention.push(a) }

  const leadsHref = has('leads') ? '/admin/leads' : '/marketer/leads'

  push({
    key: 'overdue', label: 'Follow-ups overdue', count: followUpsOverdue.count || 0,
    href: has('my_leads') && !has('leads') ? '/marketer/activities' : leadsHref,
    tone: 'danger', hint: 'These people were promised a call before today.',
  })
  push({
    key: 'due', label: 'Follow-ups due today', count: followUpsDue.count || 0,
    href: has('my_leads') && !has('leads') ? '/marketer/activities' : leadsHref,
    tone: 'warning', hint: 'Still time to reach them today.',
  })

  if (seesEverything) {
    push({
      key: 'unassigned', label: 'Leads with no owner', count: unassigned.count || 0,
      href: has('pm_leads') ? '/pm/assign' : '/admin/leads',
      tone: 'danger', hint: 'Nobody is following these up.',
    })
  }

  if (has('admissions')) {
    const [ready, awaiting] = await Promise.all([
      countOf(leads().select('id', { count: 'exact', head: true }).eq('status', 'ready_to_join')),
      countOf(sb.from('applications').select('id', { count: 'exact', head: true })
        .eq('is_submitted', true).eq('payment_status', 'pending')),
    ])
    push({
      key: 'ready', label: 'Ready to be admitted', count: ready.count || 0,
      href: '/admin/admissions', tone: 'accent',
      hint: 'Registered and paid, waiting on an admission letter.',
    })
    push({
      key: 'applications', label: 'Applications awaiting payment', count: awaiting.count || 0,
      href: '/admission/process', tone: 'warning',
      hint: 'Submitted, but the fee has not come through.',
    })
  }

  if (has('finance', 'registrations')) {
    const pending = await countOf(sb.from('fee_payments')
      .select('id', { count: 'exact', head: true }).eq('status', 'pending'))
    push({
      key: 'payments', label: 'Payments to verify', count: pending.count || 0,
      href: '/finance/student-fees', tone: 'warning',
      hint: 'A student has paid and is waiting to be confirmed.',
    })
  }

  if (has('broadcast', 'settings')) {
    const failed = await countOf(sb.from('sms_logs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed').gte('created_at', dayAgo))
    push({
      key: 'sms', label: 'Messages that never arrived', count: failed.count || 0,
      href: '/admin/sms-delivery', tone: 'danger',
      hint: 'Someone was not told something today.',
    })
  }

  // Most urgent first, and within a tone the biggest number first.
  const order = { danger: 0, warning: 1, accent: 2 }
  attention.sort((a, b) => order[a.tone] - order[b.tone] || b.count - a.count)

  /* ── who, specifically, is waiting ─────────────────────────────────────── */

  /*
   * Scoped through mine() like every other query here, so a marketer is given
   * their own leads and never another marketer's contact details. The oldest
   * promise first: the person waiting longest is the one to ring.
   *
   * This reads follow_up_at. It does not write it, reschedule it, or decide
   * what counts as a follow-up — that logic stays where it is.
   */
  const { data: priorityRows, error: priorityError } = await mine(
    leads().select('id, full_name, phone, course_interest, follow_up_at')
  )
    .not('follow_up_at', 'is', null)
    .lte('follow_up_at', now)
    .order('follow_up_at', { ascending: true })
    .limit(5)

  if (priorityError) {
    console.error('[dashboard] priority leads failed:', priorityError.message)
  }

  const priority: PriorityLead[] = (priorityRows || []).map(row => ({
    id: row.id,
    name: row.full_name || 'Unnamed lead',
    phone: row.phone || null,
    course: row.course_interest || null,
    dueAt: row.follow_up_at,
    overdue: Boolean(row.follow_up_at && row.follow_up_at < today),
    href: `${leadsHref}/${row.id}`,
  }))

  /* ── recent activity ───────────────────────────────────────────────────── */

  /*
   * The old dashboard fetched an activity feed into state that nothing
   * rendered. This one is scoped the same way the figures are, so a marketer
   * sees movement on their own leads rather than the whole centre's.
   */
  let activityQuery = sb.from('lead_activities')
    .select('id, created_at, subject, description, lead_id, created_by')
    .order('created_at', { ascending: false })
    .limit(8)
  if (!seesEverything) activityQuery = activityQuery.eq('created_by', session.userId)

  const { data: activityRows, error: activityError } = await activityQuery
  if (activityError) {
    // Surfaced in the log rather than swallowed: an empty feed because the
    // query failed must not be indistinguishable from a quiet day.
    console.error('[dashboard] activity feed failed:', activityError.message)
  }

  const activity: ActivityItem[] = (activityRows || []).map(row => ({
    id: row.id,
    at: row.created_at,
    text: row.subject || row.description || 'Activity recorded',
    href: row.lead_id ? `${leadsHref}/${row.lead_id}` : undefined,
  }))

  return NextResponse.json({
    scope: seesEverything ? 'centre' : 'mine',
    today: {
      newLeads: newLeads.count || 0,
      registered: registeredToday.count || 0,
      followUps: (followUpsDue.count || 0) + (followUpsOverdue.count || 0),
    },
    pipeline: {
      total: total.count || 0,
      readyToJoin: readyToJoin.count || 0,
      unassigned: unassigned.count || 0,
    },
    attention,
    priority,
    activity,
    activityFailed: Boolean(activityError),
  })
})

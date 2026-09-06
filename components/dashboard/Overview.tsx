'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Plus, Upload, UserPlus, CalendarClock, Phone, MessageCircle, ChevronRight,
} from 'lucide-react'
import { Skeleton, ErrorState, EmptyState, Avatar } from '@/components/ui'
import { telHref, whatsappHref, displayPhone } from '@/lib/ui/contact'
import { displayName } from '@/lib/ui/name'

/**
 * The dashboard body, shared by every role that has one.
 *
 * ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
 *
 * One question: what should I do first?
 *
 * It previously showed six totals — leads, unassigned, ready to join,
 * admissions, admitted, active staff. All true, none of them actionable. A
 * total does not change between Monday and Friday in a way that tells anyone
 * anything, and a screen of numbers that never move is a screen people stop
 * reading.
 *
 * The hierarchy is explicit, and the second level is the one that matters:
 *
 *   1. Today          — the day in four figures, in the brand's own oxblood, so the
 *                       top of the screen orients rather than instructs
 *   2. Who is waiting — NAMED PEOPLE with a phone button, not a count. This is
 *                       the change that makes the dashboard a place work
 *                       happens instead of a signpost to a list. Ringing
 *                       somebody back should not cost three taps and a search.
 *   3. Needs attention— the remaining queues, as counts, because "12 payments
 *                       to verify" genuinely is one job rather than twelve
 *   4. Quick actions  — starting something new
 *   5. Recent activity— what has been happening
 *
 * Nothing here is shown at zero. A dashboard full of zeroes trains people to
 * skim past it, and then the one that is not zero gets skimmed past too.
 *
 * It is one component rather than one per role because the difference between
 * an administrator's dashboard and a marketer's is WHICH rows come back, and
 * that decision belongs to the server, which knows what each person may see.
 * /api/dashboard/summary already scopes itself; two implementations of the
 * same screen would only give the two roles different bugs.
 */

type Attention = {
  key: string
  label: string
  count: number
  href: string
  tone: 'danger' | 'warning' | 'accent'
  hint: string
}

type PriorityLead = {
  id: string
  name: string
  phone: string | null
  course: string | null
  dueAt: string | null
  overdue: boolean
  href: string
}

type Summary = {
  scope: 'centre' | 'mine'
  today: { newLeads: number; registered: number; followUps: number }
  pipeline: { total: number; readyToJoin: number; unassigned: number }
  attention: Attention[]
  priority: PriorityLead[]
  activity: Array<{ id: string; at: string; text: string; href?: string }>
  activityFailed: boolean
}

function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 90) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** "2 days late" / "due today" — the phrase someone would actually say. */
function dueLabel(iso: string | null, overdue: boolean): string {
  if (!iso) return 'No date set'
  if (!overdue) return 'Due today'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'Overdue'
  return days === 1 ? '1 day late' : `${days} days late`
}

export default function Overview() {
  const [data, setData] = useState<Summary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const fetchSummary = useCallback(async (): Promise<Summary | null> => {
    try {
      const res = await fetch('/api/dashboard/summary')
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }, [])

  const apply = useCallback((json: Summary | null) => {
    if (!json) { setState('error'); return }
    setData(json)
    setState('ready')
  }, [])

  const reload = useCallback(async () => {
    setState('loading')
    apply(await fetchSummary())
  }, [apply, fetchSummary])

  // State is already 'loading', so nothing is set until the response lands —
  // no cascading render on mount.
  useEffect(() => {
    let alive = true
    fetchSummary().then(json => { if (alive) apply(json) })
    return () => { alive = false }
  }, [apply, fetchSummary])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const mine = data?.scope === 'mine'

  /*
   * The one sentence worth putting under the greeting.
   *
   * It used to read "Here is what is waiting on you", which says nothing the
   * section heading two inches below does not already say. The most urgent
   * TRUE fact is how long the longest-waiting person has been waiting — that
   * is the thing somebody opening this at 8am needs to know before anything
   * else, and it is the reason to keep reading.
   */
  const worst = data?.priority.find(p => p.overdue) || null
  const overdueCount = data?.priority.filter(p => p.overdue).length || 0

  const summary = (() => {
    if (!data) return ''
    if (overdueCount > 0 && worst) {
      const late = dueLabel(worst.dueAt, true).toLowerCase()
      return overdueCount === 1
        ? `${displayName(worst.name)} has been waiting ${late.replace(' late', '')}.`
        : `${overdueCount} people are overdue — the longest by ${late.replace(' late', '')}.`
    }
    if (data.priority.length > 0) {
      return data.priority.length === 1
        ? 'One person is due a call today.'
        : `${data.priority.length} people are due a call today.`
    }
    if (data.attention.length > 0) return 'Nobody is waiting on a call. A few queues need a look.'
    return 'Nothing is waiting on you right now.'
  })()

  const quickActions = mine
    ? [
        { label: 'Add a lead', href: '/marketer/leads/new', icon: Plus },
        { label: 'My leads', href: '/marketer/leads', icon: UserPlus },
        { label: 'Follow-ups', href: '/marketer/activities', icon: CalendarClock },
        { label: 'My activity', href: '/marketer/activities', icon: MessageCircle },
      ]
    : [
        { label: 'Add a lead', href: '/admin/leads/new', icon: Plus },
        { label: 'Import a list', href: '/admin/leads/import', icon: Upload },
        { label: 'All leads', href: '/admin/leads', icon: UserPlus },
        { label: 'Admissions', href: '/admin/admissions', icon: CalendarClock },
      ]

  return (
    <div className="fade-in w-full max-w-5xl">
      <header className="mb-6 sm:mb-7">
        <h1 className="t-display">{greeting}</h1>
        {/*
          The subtitle carries the single most urgent true fact, not a
          pleasantry. "Here is what is waiting on you" said nothing that the
          section headings below did not already say; "one has been waiting
          10 days" is the reason to keep reading.
        */}
        <p className="t-lead mt-1">{state === 'ready' ? summary : 'Loading your day…'}</p>
      </header>

      {state === 'error' && (
        <ErrorState
          title="Could not load your dashboard"
          message="The figures did not come back. Check your connection and try again."
          onRetry={reload}
        />
      )}

      {state === 'loading' && (
        <div className="space-y-3">
          <Skeleton className="h-[104px] rounded-2xl" />
          <Skeleton className="h-[76px] rounded-2xl" />
          <Skeleton className="h-[76px] rounded-2xl" />
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Skeleton className="h-[68px] rounded-2xl" />
            <Skeleton className="h-[68px] rounded-2xl" />
          </div>
        </div>
      )}

      {state === 'ready' && data && (
        <>
          {/*
            ── 1. Who is waiting ───────────────────────────────────────────

            Named people, with the two buttons that actually get used. Both
            are plain anchors to tel: and wa.me — no handler, no state, so
            they work on a phone with the app backgrounded and cannot be
            broken by a hydration failure.

            A row without a number keeps its buttons out rather than showing
            two dead controls: an imported lead with no phone is common, and a
            call button that does nothing is worse than no button.
          */}
          {data.priority.length > 0 && (
            <section className="mb-8" aria-labelledby="priority-heading">
              <div className="flex items-baseline justify-between mb-3">
                <h2 id="priority-heading" className="t-overline">Waiting on you</h2>
                <Link href={mine ? '/marketer/activities' : '/admin/leads'}
                  className="text-[12px] font-medium text-[var(--accent)] hover:underline">
                  See all
                </Link>
              </div>

              <ul className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] overflow-hidden
                divide-y divide-[var(--line-soft)]">
                {data.priority.map(lead => {
                  const tel = telHref(lead.phone)
                  const wa = whatsappHref(lead.phone)
                  return (
                    <li key={lead.id} className="flex items-center gap-3.5 px-4 py-3.5">
                      <Link href={lead.href}
                        className="flex items-center gap-3 min-w-0 flex-1 group
                          focus-visible:outline-none focus-visible:ring-2
                          focus-visible:ring-[var(--accent)] rounded-lg -m-1 p-1">
                        <Avatar name={displayName(lead.name)} size="lg" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold text-[var(--ink)] truncate
                            group-hover:text-[var(--accent)] transition-colors">
                            {displayName(lead.name)}
                          </span>
                          <span className="block text-[13px] truncate mt-0.5 text-[var(--ink-soft)]">
                            <span className={lead.overdue ? 'text-[var(--danger)] font-medium' : ''}>
                              {dueLabel(lead.dueAt, lead.overdue)}
                            </span>
                            {lead.course && ` · ${lead.course}`}
                          </span>
                        </span>
                      </Link>

                      {tel && wa && (
                        <span className="flex items-center gap-1.5 flex-shrink-0">
                          <a href={tel} aria-label={`Call ${displayName(lead.name)} on ${displayPhone(lead.phone)}`}
                            className="w-10 h-10 grid place-items-center rounded-full
                              bg-[var(--brand-soft)] text-[var(--accent)]
                              hover:bg-[var(--brand-line)] transition-colors
                              focus-visible:outline-none focus-visible:ring-2
                              focus-visible:ring-[var(--accent)]">
                            <Phone size={16} aria-hidden="true" />
                          </a>
                          <a href={wa} target="_blank" rel="noopener noreferrer"
                            aria-label={`Message ${displayName(lead.name)} on WhatsApp`}
                            className="w-10 h-10 grid place-items-center rounded-full
                              bg-[var(--brand-soft)] text-[var(--accent)]
                              hover:bg-[var(--brand-line)] transition-colors
                              focus-visible:outline-none focus-visible:ring-2
                              focus-visible:ring-[var(--accent)]">
                            <MessageCircle size={16} aria-hidden="true" />
                          </a>
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* ── 2. The remaining queues ─────────────────────────────────── */}
          {data.attention.length > 0 ? (
            <section className="mb-8" aria-labelledby="attention-heading">
              <h2 id="attention-heading" className="t-overline mb-3">Needs attention</h2>

              <ul className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] overflow-hidden
                divide-y divide-[var(--line-soft)]">
                {data.attention.map(item => (
                  <li key={item.key}>
                    <Link href={item.href}
                      className="flex items-center gap-3.5 px-4 py-3.5 group
                        hover:bg-[var(--canvas)] transition-colors
                        focus-visible:outline-none focus-visible:bg-[var(--canvas)]">
                      {/*
                        The count sits INSIDE the sentence rather than beside
                        it as a 20px figure against a coloured rule.
                        Four rules in four colours down the left of a list is a
                        stack of traffic lights, and it made every queue look
                        like an incident. Only a genuinely overdue count takes
                        a colour, and it takes it on the number alone.
                      */}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] text-[var(--ink)] leading-snug">
                          <span className={`numeric font-semibold ${
                            item.tone === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--ink)]'
                          }`}>
                            {item.count}
                          </span>
                          {' '}{item.label.toLowerCase()}
                        </span>
                        <span className="block t-meta mt-0.5">{item.hint}</span>
                      </span>

                      <ChevronRight size={16} aria-hidden="true"
                        className="text-[var(--ink-faint)] flex-shrink-0
                          group-hover:text-[var(--ink-soft)] transition-colors" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : data.priority.length === 0 && (
            <section className="mb-6">
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-5 py-8 text-center">
                <p className="text-[14px] font-medium text-[var(--ink)]">Nothing needs attention</p>
                <p className="t-sub mt-1">
                  No follow-ups are due and nothing is waiting to be assigned.
                </p>
              </div>
            </section>
          )}

          {/*
            ── 3. The day so far ───────────────────────────────────────────

            Orientation, not instruction — so it is quiet and it is low.

            This was the first thing on the page: a filled dark panel holding
            three 28px numbers. That is the most recognisable shape in generated
            dashboards, and it gave "5 new leads" more weight than a person who
            had been waiting ten days for a call. Numbers that nobody acts on
            do not belong at the top of a screen, and they do not need a
            surface of their own.
          */}
          <section aria-labelledby="today-heading" className="mb-8">
            <h2 id="today-heading" className="t-overline mb-3">The day so far</h2>

            <dl className="flex items-start divide-x divide-[var(--line)]
              border-y border-[var(--line)] py-4">
              {[
                { label: 'New leads', value: data.today.newLeads },
                { label: mine ? 'Registered' : 'Registrations', value: data.today.registered },
                { label: 'Follow-ups', value: data.today.followUps },
              ].map(stat => (
                <div key={stat.label} className="flex-1 px-4 first:pl-0 last:pr-0">
                  <dt className="t-meta">{stat.label}</dt>
                  <dd className="numeric text-[19px] font-semibold text-[var(--ink)] mt-1 leading-none">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="t-meta mt-3">
              {data.pipeline.total} {mine ? 'assigned to you' : 'leads in total'}
              {' · '}{data.pipeline.readyToJoin} ready to join
              {data.pipeline.unassigned > 0 && ` · ${data.pipeline.unassigned} unassigned`}
            </p>
          </section>

          {/*
            ── 4. Starting something ───────────────────────────────────────

            A 2×2 grid on a phone: four targets a thumb can hit without aiming,
            rather than a row of pills that wrap unpredictably at 320px.
          */}
          <section className="mb-8">
            <h2 className="t-overline mb-3">Quick actions</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {quickActions.map(action => {
                const Icon = action.icon
                return (
                  <Link key={action.label} href={action.href}
                    className="flex items-center gap-3 min-h-[56px] px-3.5 rounded-2xl border
                      border-[var(--line)] bg-[var(--paper)] text-[13px] font-medium text-[var(--ink)]
                      hover:bg-[var(--canvas)] transition-colors
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                    <span aria-hidden="true"
                      className="w-8 h-8 rounded-lg grid place-items-center flex-shrink-0
                        bg-[var(--brand-soft)] text-[var(--accent)]">
                      <Icon size={16} />
                    </span>
                    <span className="leading-tight min-w-0">{action.label}</span>
                  </Link>
                )
              })}
            </div>
          </section>

          {/* ── 5. What has been happening ──────────────────────────────── */}
          <section aria-labelledby="activity-heading">
            <h2 id="activity-heading" className="t-overline mb-3">Recent activity</h2>

            {data.activityFailed ? (
              <ErrorState
                title="Could not load recent activity"
                message="The rest of this page is up to date; only the activity feed failed."
                onRetry={reload}
              />
            ) : data.activity.length === 0 ? (
              <EmptyState
                title="Nothing logged yet"
                description="Notes and calls recorded against a lead will appear here."
              />
            ) : (
              <ul className="divide-y divide-[var(--line-soft)] rounded-2xl border border-[var(--line)]
                bg-[var(--paper)] overflow-hidden">
                {data.activity.map(entry => {
                  const body = (
                    <span className="flex items-start justify-between gap-3 px-4 py-3.5">
                      <span className="text-[13px] text-[var(--ink)] leading-snug min-w-0 break-words">
                        {entry.text}
                      </span>
                      <time dateTime={entry.at}
                        className="text-[12px] text-[var(--ink-faint)] flex-shrink-0 tabular-nums pt-0.5">
                        {ago(entry.at)}
                      </time>
                    </span>
                  )
                  return (
                    <li key={entry.id}>
                      {entry.href
                        ? <Link href={entry.href}
                            className="block hover:bg-[var(--canvas)] transition-colors
                              focus-visible:outline-none focus-visible:ring-2
                              focus-visible:ring-inset focus-visible:ring-[var(--accent)]">
                            {body}
                          </Link>
                        : body}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

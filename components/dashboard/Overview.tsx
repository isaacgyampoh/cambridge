'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Plus, Upload, UserPlus, ArrowRight } from 'lucide-react'
import { Card, SectionHeader, Skeleton, ErrorState, EmptyState } from '@/components/ui'

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
 * reading. When every figure is presented as equally important, none of them
 * is.
 *
 * So the hierarchy is explicit and there are only three levels:
 *
 *   1. What is waiting on you       — the largest thing on the page, and the
 *                                     only part with somewhere to go
 *   2. What happened today          — three small figures, for orientation
 *   3. What has been happening      — the activity feed
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

type Summary = {
  scope: 'centre' | 'mine'
  today: { newLeads: number; registered: number; followUps: number }
  pipeline: { total: number; readyToJoin: number; unassigned: number }
  attention: Attention[]
  activity: Array<{ id: string; at: string; text: string; href?: string }>
  activityFailed: boolean
}

const TONE_RING: Record<Attention['tone'], string> = {
  danger: 'border-[var(--danger)]/25 bg-[var(--danger-soft)]',
  warning: 'border-[var(--warn)]/25 bg-[var(--warn-soft)]',
  accent: 'border-[var(--accent)]/25 bg-[var(--accent-soft)]',
}
const TONE_TEXT: Record<Attention['tone'], string> = {
  danger: 'text-[var(--danger)]',
  warning: 'text-[var(--warn)]',
  accent: 'text-[var(--accent)]',
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

  const quickActions = mine
    ? [
        { label: 'Add a lead', href: '/marketer/leads/new', icon: Plus },
        { label: 'My leads', href: '/marketer/leads', icon: UserPlus },
        { label: 'Follow-ups', href: '/marketer/activities', icon: ArrowRight },
      ]
    : [
        { label: 'Add a lead', href: '/admin/leads/new', icon: Plus },
        { label: 'Import a list', href: '/admin/leads/import', icon: Upload },
        { label: 'All leads', href: '/admin/leads', icon: UserPlus },
      ]

  return (
    <div className="fade-in w-full max-w-5xl">
      <header className="mb-6 sm:mb-8">
        <h1 className="font-display text-[26px] sm:text-[32px] font-semibold text-[var(--ink)] leading-tight">
          {greeting}
        </h1>
        <p className="text-[var(--ink-soft)] text-[14px] sm:text-[15px] mt-1.5">
          {state === 'ready'
            ? (data?.attention.length
                ? 'Here is what is waiting on you.'
                : 'Nothing is waiting on you right now.')
            : 'Loading your day…'}
        </p>
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
          <Skeleton className="h-[92px] rounded-2xl" />
          <Skeleton className="h-[92px] rounded-2xl" />
          <div className="grid grid-cols-3 gap-3 pt-3">
            <Skeleton className="h-[74px] rounded-2xl" />
            <Skeleton className="h-[74px] rounded-2xl" />
            <Skeleton className="h-[74px] rounded-2xl" />
          </div>
        </div>
      )}

      {state === 'ready' && data && (
        <>
          {/* ── 1. What is waiting on you ─────────────────────────────── */}
          {data.attention.length > 0 ? (
            <section className="mb-8" aria-labelledby="attention-heading">
              <h2 id="attention-heading" className="sr-only">Needs your attention</h2>
              <ul className="space-y-2.5 stagger">
                {data.attention.map(item => (
                  <li key={item.key}>
                    <Link href={item.href}
                      className={`flex items-center gap-4 p-4 rounded-2xl border transition-colors
                        hover:brightness-[0.98] active:brightness-95
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
                        ${TONE_RING[item.tone]}`}>
                      {/* The number leads, because it is the thing that decides
                          whether this is worth opening. */}
                      <span className={`font-display text-[30px] leading-none font-semibold tabular-nums
                        flex-shrink-0 min-w-[46px] ${TONE_TEXT[item.tone]}`}>
                        {item.count}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-[var(--ink)] leading-snug">
                          {item.label}
                        </span>
                        <span className="block text-[13px] text-[var(--ink-soft)] mt-0.5 leading-snug">
                          {item.hint}
                        </span>
                      </span>
                      <ArrowRight size={18} aria-hidden="true"
                        className={`flex-shrink-0 ${TONE_TEXT[item.tone]}`} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="mb-8">
              <EmptyState
                title="You are all caught up"
                description="No follow-ups are due, nothing is waiting to be assigned, and every payment has been verified."
              />
            </section>
          )}

          {/* ── 2. Today ──────────────────────────────────────────────── */}
          <section className="mb-8" aria-labelledby="today-heading">
            <SectionHeader title="Today" />
            <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
              {[
                { label: 'New leads', value: data.today.newLeads },
                { label: mine ? 'Registered' : 'Registrations', value: data.today.registered },
                { label: 'Follow-ups', value: data.today.followUps },
              ].map(stat => (
                <Card key={stat.label} className="p-3.5 sm:p-4">
                  <div className="font-display text-[24px] sm:text-[28px] leading-none font-semibold
                    text-[var(--ink)] tabular-nums">
                    {stat.value}
                  </div>
                  <div className="text-[12.5px] text-[var(--ink-soft)] mt-1.5 leading-snug">
                    {stat.label}
                  </div>
                </Card>
              ))}
            </div>
            <p className="text-[12.5px] text-[var(--ink-faint)] mt-2.5">
              {mine
                ? `${data.pipeline.total} leads assigned to you · ${data.pipeline.readyToJoin} ready to join`
                : `${data.pipeline.total} leads in total · ${data.pipeline.readyToJoin} ready to join`}
            </p>
          </section>

          {/* ── 3. Quick actions ──────────────────────────────────────── */}
          <section className="mb-8">
            <SectionHeader title="Start something" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {quickActions.map(action => {
                const Icon = action.icon
                return (
                  <Link key={action.href} href={action.href}
                    className="flex items-center gap-3 px-4 min-h-[56px] rounded-xl border
                      border-[var(--line)] bg-[var(--paper)] text-[14px] font-medium text-[var(--ink)]
                      hover:border-[var(--ink-faint)] hover:bg-[var(--canvas)] transition-colors
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                    <Icon size={17} aria-hidden="true" className="text-[var(--accent)] flex-shrink-0" />
                    {action.label}
                  </Link>
                )
              })}
            </div>
          </section>

          {/* ── 4. What has been happening ────────────────────────────── */}
          <section aria-labelledby="activity-heading">
            <SectionHeader title="Recent activity"
              description={mine ? 'Your notes and calls.' : 'Across the centre.'} />

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
                      <span className="text-[14px] text-[var(--ink)] leading-snug min-w-0 break-words">
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

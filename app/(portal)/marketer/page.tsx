'use client'
import Link from 'next/link'

import { useState, useEffect, useCallback } from 'react'
import { Card, SectionHeader, Skeleton, ErrorState } from '@/components/ui'
import { formatGHS } from '@/lib/utils'
import Overview from '@/components/dashboard/Overview'
import type { IndustryGroup } from '@/lib/leads/industryStats'

/**
 * A marketer's home.
 *
 * ── WHAT CHANGED ───────────────────────────────────────────────────────────
 *
 * This screen led with four totals — leads, converted, fees earned, points —
 * and put "needs your attention" below them, where it covered exactly one
 * case: leads that had gone quiet for five days. Follow-ups that were actually
 * due, or already overdue, were not mentioned anywhere, which is the single
 * most useful thing a marketer could be told when they open the application.
 *
 * The shared Overview now leads, so the first thing on the page is what is
 * waiting on this person. Their own figures follow it, because "how am I
 * doing" is a real question but not the first one of the day.
 *
 * It also swallowed its own failures: `.catch(() => setS({}))` turned a failed
 * request into a dashboard of zeroes, which reads as "you have done nothing"
 * rather than "this did not load".
 */

type Quota = {
  target: number | null
  used: number
  conversions: number
  remaining: number | null
  periodLabel: string | null
}

type MarketerStats = {
  quota?: Quota | null
  quotaError?: string | null
  /** Leads nobody has touched yet — the first question a marketer asks. */
  newLeads?: number
  /** Live leads that have gone quiet: the follow-up list. */
  cold?: number
  totalLeads?: number
  registered?: number
  conversionRate?: number
  regFees?: number
  points?: number
}

export default function MarketerHome() {
  const [stats, setStats] = useState<MarketerStats | null>(null)
  /*
   * The industry breakdown, from the endpoint that counts every lead this
   * person owns. Separate from the dashboard call so a slow or missing
   * breakdown never holds up the figures above it — and so an older database
   * with no industry column simply shows no card.
   */
  const [industry, setIndustry] = useState<IndustryGroup[]>([])
  const [role, setRole] = useState('')
  const [name, setName] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const fetchStats = useCallback(async () => {
    try {
      const [dash, me, groups] = await Promise.all([
        fetch('/api/marketer/dashboard').then(r => (r.ok ? r.json() : null)),
        fetch('/api/auth/me').then(r => (r.ok ? r.json() : null)),
        fetch('/api/leads/industry-summary').then(r => (r.ok ? r.json() : null)).catch(() => null),
      ])
      if (!dash) return null
      return { dash: dash as MarketerStats, me, groups }
    } catch {
      return null
    }
  }, [])

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchStats>>) => {
    if (!result) { setState('error'); return }
    setStats(result.dash)
    setIndustry(result.groups?.available ? (result.groups.groups || []) : [])
    setName((result.me?.fullName || '').split(' ')[0])
    setRole(result.me?.role || '')
    setState('ready')
  }, [])

  const reload = useCallback(async () => {
    setState('loading')
    apply(await fetchStats())
  }, [apply, fetchStats])

  useEffect(() => {
    let alive = true
    fetchStats().then(r => { if (alive) apply(r) })
    return () => { alive = false }
  }, [apply, fetchStats])

  // Only a full-time marketer sees the registration-fee amount; staff who
  // market as a secondary duty do not earn it.
  const showFee = role === 'marketing_officer'

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* What is waiting on this person, first. */}
      <Overview />

      <section className="mt-10" aria-labelledby="my-numbers">
        <SectionHeader
          title={name ? `How ${name} is doing` : 'How you are doing'}
          description="Your own figures for the year."
        />

        {state === 'error' ? (
          <ErrorState
            title="Could not load your figures"
            message="Everything above is up to date; only your own totals failed to load."
            onRetry={reload}
          />
        ) : state === 'loading' ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[84px] rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/*
              * WHAT DO I DO NEXT, FIRST.
              *
              * The two figures that answer it — leads nobody has touched, and
              * live leads that have gone quiet — were already being computed
              * by /api/marketer/dashboard and were never shown. The screen
              * opened on totals and commission, which say how the year is
              * going and nothing about this morning.
              *
              * They are links, because a count somebody cannot act on is
              * decoration.
              */}
            {[
              { label: 'New leads', value: String(stats?.newLeads ?? 0),
                sub: 'Not contacted yet', href: '/marketer/leads?show=new', lead: true },
              { label: 'Needs follow-up', value: String(stats?.cold ?? 0),
                sub: 'Gone quiet', href: '/marketer/leads?show=followup',
                warn: (stats?.cold ?? 0) > 0 },
              { label: 'Registered', value: String(stats?.registered ?? 0),
                sub: `${stats?.conversionRate ?? 0}% conversion`, href: '/marketer/leads?show=registered' },
              showFee
                ? { label: 'Fees earned', value: formatGHS(stats?.regFees ?? 0), sub: 'Commission this year' }
                : { label: 'All leads', value: String(stats?.totalLeads ?? 0), sub: 'Assigned to you', href: '/marketer/leads' },
            ].map(stat => {
              const inner = (
                <>
                  <div className="font-display text-[20px] sm:text-[24px] leading-none font-semibold
                    text-[var(--ink)] tabular-nums truncate">
                    {stat.value}
                  </div>
                  <div className="text-[12px] text-[var(--ink-soft)] mt-1.5 leading-snug">{stat.label}</div>
                  {stat.sub && (
                    <div className="text-[11px] text-[var(--ink-faint)] mt-0.5 leading-snug">{stat.sub}</div>
                  )}
                </>
              )
              const tone = stat.lead
                ? 'bg-[var(--accent-bright)] border-transparent'
                : stat.warn
                  ? 'bg-[var(--attention-soft)] border-[var(--attention)]'
                  : ''
              return stat.href ? (
                <Link key={stat.label} href={stat.href}
                  className={`block p-4 rounded-[var(--radius-surface)] border border-[var(--line)] bg-[var(--paper)] min-h-[84px]
                    transition-colors hover:border-[var(--ink-faint)]
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] ${tone}`}>
                  {inner}
                </Link>
              ) : (
                <Card key={stat.label} className="p-4">{inner}</Card>
              )
            })}
          </div>
        )}

        {/*
          * THE TARGET, AND HOW FAR THROUGH IT THEY ARE.
          *
          * marketer_targets has been in the schema since schema-v3 with
          * nothing in the application ever reading it, so "what is my quota?"
          * had no answer anywhere in the portal. It is shown only when
          * somebody has actually set one — an invented target would be worse
          * than none.
          */}
        {stats?.quotaError ? (
          <p className="mt-4 text-[13px] text-[var(--ink-faint)]">{stats.quotaError}</p>
        ) : stats?.quota && stats.quota.target !== null ? (
          <Card className="mt-4 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-[13px] font-semibold text-[var(--ink)]">
                Your target {stats.quota.periodLabel ? `— ${stats.quota.periodLabel}` : ''}
              </div>
              <div className="text-[13px] text-[var(--ink-soft)] tabular-nums">
                <span className="font-semibold text-[var(--ink)]">{stats.quota.used}</span>
                {' of '}{stats.quota.target}
                {stats.quota.remaining !== null && (
                  <span className="text-[var(--ink-faint)]">
                    {' · '}{stats.quota.remaining} to go
                  </span>
                )}
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-[var(--line-soft)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent-bright)]"
                style={{
                  width: `${Math.min(100, Math.round((stats.quota.used / Math.max(1, stats.quota.target)) * 100))}%`,
                }}
              />
            </div>
            {stats.quota.remaining === 0 && (
              <p className="mt-2 text-[12px] text-[var(--ink-soft)]">
                Target reached for this period. Leads keep coming — this is a target, not a cap.
              </p>
            )}
          </Card>
        ) : stats?.quota ? (
          <p className="mt-4 text-[13px] text-[var(--ink-faint)]">
            No target has been set for you this period. You have received{' '}
            <span className="font-semibold text-[var(--ink)]">{stats.quota.used}</span>{' '}
            lead{stats.quota.used === 1 ? '' : 's'}.
          </p>
        ) : null}

        {/*
          * WHAT THEIR LEADS DO FOR A LIVING.
          *
          * Deliberately below the target and in its own card: a target is a
          * period figure measured against a number somebody set, and this is
          * a breakdown of everything they hold. Reading as one block, the
          * industry totals look like progress towards the target and do not
          * add up to it.
          *
          * Every lead appears in exactly one row, so these totals sum to the
          * total — see breakdownBalances in lib/leads/industryStats.ts.
          */}
        {industry.length > 0 && (
          <Card className="mt-4 p-4">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <h2 className="text-[13px] font-semibold text-[var(--ink)]">Your leads by industry</h2>
              <span className="text-[12px] text-[var(--ink-faint)] tabular-nums">
                {industry.reduce((n, g) => n + g.total, 0)} in all
              </span>
            </div>
            <p className="text-[12px] text-[var(--ink-faint)] mb-3 leading-snug">
              Everything assigned to you, whenever it arrived. Tap one to work through it.
            </p>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-[var(--ink-faint)] border-b border-[var(--line)]">
                    <th className="text-left font-semibold py-1.5">Industry</th>
                    <th className="text-right font-semibold py-1.5">Leads</th>
                    <th className="text-right font-semibold py-1.5">Registered</th>
                    <th className="text-right font-semibold py-1.5">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {industry.map(g => (
                    <tr key={g.code} className="border-b border-[var(--line-soft)] last:border-0">
                      <td className="py-2 pr-2">
                        <Link href={`/marketer/leads?industry=${encodeURIComponent(g.code)}`}
                          className="font-medium text-[var(--ink)] hover:text-[var(--accent)] transition">
                          {g.label}
                        </Link>
                        {g.courses.length > 0 && (
                          <div className="text-[11px] text-[var(--ink-faint)] mt-0.5 truncate max-w-[14rem]">
                            {g.courses.slice(0, 3).map(c => `${c.course} (${c.count})`).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums font-semibold text-[var(--ink)]">{g.total}</td>
                      <td className="py-2 text-right tabular-nums text-[var(--ok)]">{g.converted}</td>
                      <td className="py-2 text-right tabular-nums text-[var(--ink-soft)]">{g.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </div>
  )
}

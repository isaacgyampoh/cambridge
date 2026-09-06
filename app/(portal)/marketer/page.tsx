'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, SectionHeader, Skeleton, ErrorState } from '@/components/ui'
import { formatGHS } from '@/lib/utils'
import Overview from '@/components/dashboard/Overview'

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

type MarketerStats = {
  totalLeads?: number
  registered?: number
  conversionRate?: number
  regFees?: number
  points?: number
}

export default function MarketerHome() {
  const [stats, setStats] = useState<MarketerStats | null>(null)
  const [role, setRole] = useState('')
  const [name, setName] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const fetchStats = useCallback(async () => {
    try {
      const [dash, me] = await Promise.all([
        fetch('/api/marketer/dashboard').then(r => (r.ok ? r.json() : null)),
        fetch('/api/auth/me').then(r => (r.ok ? r.json() : null)),
      ])
      if (!dash) return null
      return { dash: dash as MarketerStats, me }
    } catch {
      return null
    }
  }, [])

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchStats>>) => {
    if (!result) { setState('error'); return }
    setStats(result.dash)
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
    <div className="w-full max-w-5xl">
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
            {[
              { label: 'Leads', value: String(stats?.totalLeads ?? 0) },
              { label: 'Registered', value: String(stats?.registered ?? 0),
                sub: `${stats?.conversionRate ?? 0}% conversion` },
              showFee
                ? { label: 'Fees earned', value: formatGHS(stats?.regFees ?? 0), sub: 'Commission this year' }
                : { label: 'Registrations', value: String(stats?.registered ?? 0), sub: 'This year' },
              { label: 'Points', value: String(stats?.points ?? 0), sub: 'Toward your rank' },
            ].map(stat => (
              <Card key={stat.label} className="p-4">
                <div className="font-display text-[20px] sm:text-[24px] leading-none font-semibold
                  text-[var(--ink)] tabular-nums truncate">
                  {stat.value}
                </div>
                <div className="text-[12px] text-[var(--ink-soft)] mt-1.5 leading-snug">{stat.label}</div>
                {stat.sub && (
                  <div className="text-[11px] text-[var(--ink-faint)] mt-0.5 leading-snug">{stat.sub}</div>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

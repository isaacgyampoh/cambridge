'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { StatCard } from '@/components/ui'
import { SkeletonStat, ErrorState } from '@/components/ui/states'

/**
 * The dashboard.
 *
 * It used to pull 500 leads, 200 admissions, 500 payments and 200 profiles
 * into the browser and count them in JavaScript — about 1,400 rows to render
 * eight numbers. Two of those fetches were dead: `payments` was never read,
 * and the activity feed was loaded into state nothing rendered. A third was
 * broken: the admissions sparkline filtered on `created_at`, which the query
 * did not select, so it was always zero.
 *
 * Now one call to /api/dashboard/summary, counted in Postgres, with a skeleton
 * while it loads and a retry if it fails.
 */

type Summary = {
  scope: 'centre' | 'mine'
  leads: { total: number; today: number; unassigned: number; readyToJoin: number }
  trend: { thisWeek: number; lastWeek: number; deltaPercent: number | null }
  admissions: { total: number; admitted: number }
  staff: { active: number }
}

export default function AdminDashboard() {
  const [data, setData] = useState<Summary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await fetch('/api/dashboard/summary')
      if (!res.ok) throw new Error(String(res.status))
      setData(await res.json())
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/dashboard/summary')
      .then(async res => {
        if (!res.ok) throw new Error(String(res.status))
        const json = await res.json()
        if (!cancelled) { setData(json); setState('ready') }
      })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [])

  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning'
    : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'

  const mine = data?.scope === 'mine'

  return (
    <div className="fade-in w-full">
      <header className="mb-7 sm:mb-8">
        <h1 className="font-display text-[26px] sm:text-[32px] font-semibold text-[var(--ink)] leading-tight">
          {greeting}
        </h1>
        <p className="text-[var(--ink-soft)] text-[14px] sm:text-[15px] mt-1.5">
          {mine
            ? 'Your leads and what needs attention today.'
            : 'What is happening across the centre today.'}
        </p>
      </header>

      {state === 'error' && (
        <ErrorState
          title="Could not load your dashboard"
          message="The figures did not come back. Check your connection and try again."
          onRetry={load}
        />
      )}

      {state === 'loading' && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonStat key={i} />)}
        </div>
      )}

      {state === 'ready' && data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-8 sm:mb-10">
            <StatCard
              label={mine ? 'My leads' : 'Total leads'}
              value={data.leads.total}
              sub={`${data.leads.today} added today`}
              trend={data.trend.deltaPercent === null ? undefined : {
                value: `${Math.abs(data.trend.deltaPercent)}%`,
                up: data.trend.deltaPercent >= 0,
              }}
            />
            {!mine && (
              <StatCard
                label="Unassigned"
                value={data.leads.unassigned}
                sub={data.leads.unassigned > 0 ? 'Waiting to be given out' : 'All assigned'}
              />
            )}
            <StatCard
              label="Ready to join"
              value={data.leads.readyToJoin}
              sub="Registered, awaiting admission"
              accent
            />
            <StatCard label="Admissions" value={data.admissions.total} sub="Registrations processed" />
            <StatCard
              label="Admitted"
              value={data.admissions.admitted}
              sub={`of ${data.admissions.total} processed`}
            />
            {!mine && <StatCard label="Active staff" value={data.staff.active} sub="Across all roles" />}
          </div>

          <section>
            <h2 className="text-[15px] font-semibold text-[var(--ink)] mb-3.5">Jump to</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {[
                { label: 'Leads', href: mine ? '/marketer/leads' : '/admin/leads',
                  sub: mine ? `${data.leads.total} assigned to you` : `${data.leads.unassigned} unassigned` },
                { label: 'Admissions', href: '/admin/admissions',
                  sub: `${data.leads.readyToJoin} ready to join` },
                { label: 'Finance', href: '/admin/finance', sub: 'Fees and payments' },
                { label: 'Staff', href: '/admin/staff', sub: `${data.staff.active} active` },
              ].map(l => (
                <Link key={l.href} href={l.href}
                  className="flex items-center justify-between gap-3 px-4 min-h-[60px] rounded-xl
                    border border-[var(--line)] bg-[var(--paper)] hover:border-[var(--ink-faint)]
                    hover:bg-[var(--canvas)] transition-colors group
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium text-[var(--ink)] truncate">{l.label}</span>
                    <span className="block text-[12px] text-[var(--ink-faint)] mt-0.5 truncate">{l.sub}</span>
                  </span>
                  <span aria-hidden="true"
                    className="text-[var(--ink-faint)] group-hover:text-[var(--accent)] transition-colors shrink-0">
                    ›
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

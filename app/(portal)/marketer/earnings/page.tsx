'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, StatCard, Spinner, SectionLabel, Badge } from '@/components/ui'
import { formatGHS } from '@/lib/utils'
import { Trophy, TrendingUp, Wallet, Target, Award } from 'lucide-react'

export default function MarketerEarnings() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const [role, setRole] = useState('')

  useEffect(() => {
    fetch('/api/remuneration?scope=me').then(r => r.json()).then(d => { setData(d); setLoading(false) })
    fetch('/api/auth/me').then(r => r.json()).then(d => setRole(d.role || '')).catch(() => {})
  }, [])

  if (loading || !data) return <Spinner />

  const rank = data.currentRank
  const next = data.nextRank
  const isFullMarketer = role === 'marketing_officer'

  // Staff who market as a secondary duty are not on the salary/commission
  // scheme — they see their registration COUNT (to collect in person), never
  // the cedi amounts.
  if (!isFullMarketer) {
    return (
      <div className="fade-in w-full max-w-3xl mx-auto">
        <PageHeader eyebrow={`${data.year} performance`} title="My registrations"
          description="The students you've registered this year. Registration payments are settled with you directly." />
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Registered students" value={data.enrollmentCount ?? 0} sub={`in ${data.year}`} accent />
          <StatCard label="Points" value={data.totalPoints ?? 0} sub="Toward your rank" />
        </div>
      </div>
    )
  }

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow={`${data.year} performance`}
        title="My rank & earnings"
        description="Your points, rank and salary band accumulate as you convert leads through the year."
      />

      {/* Hero rank card */}
      <div className="rounded-2xl bg-[var(--accent)] text-white p-6 sm:p-8 mb-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 rounded-full bg-white/5 -mr-16 -mt-16" />
        <div className="absolute bottom-0 right-20 w-32 h-32 rounded-full bg-white/5 -mb-12" />
        <div className="relative">
          <div className="flex items-center gap-2 text-white/60 text-[12px] mb-2">
             Current rank
          </div>
          <div className="flex flex-wrap items-end gap-4 mb-1">
            <div className="font-display text-[40px] leading-none font-semibold">{rank?.name || 'Unranked'}</div>
            <div className="text-white/80 text-lg mb-0.5">{formatGHS(data.grossSalary)}<span className="text-white/50 text-sm"> / year</span></div>
          </div>
          <div className="text-white/60 text-sm">{data.totalPoints} points earned in {data.year}</div>

          {/* Progress to next rank */}
          {next ? (
            <div className="mt-6">
              <div className="flex justify-between text-xs text-white/70 mb-2">
                <span>{rank?.name || 'Start'}</span>
                <span>{data.pointsToNext} points to {next.name} ({formatGHS(next.gross_salary)})</span>
              </div>
              <div className="h-2.5 bg-white/15 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${data.progressPct}%` }} />
              </div>
            </div>
          ) : rank ? (
            <div className="mt-6 inline-flex items-center gap-2 bg-white/15 rounded-lg px-3 py-1.5 text-sm">
               Top rank achieved — outstanding work
            </div>
          ) : null}
        </div>
      </div>

      {/* Earnings stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total points" value={data.totalPoints} sub={`${data.enrollmentCount} enrollments`}  />
        <StatCard label="Gross salary" value={formatGHS(data.grossSalary)} sub={rank?.name || 'Reach Alpha-1'}  />
        <StatCard label="Registration commission" value={formatGHS(data.registrationCommission)} sub="GHS 200 / student — yours"  accent />
        <StatCard label="To next rank" value={next ? data.pointsToNext : '—'} sub={next ? `points to ${next.name}` : 'Top rank'}  />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Points by program */}
        <Card className="p-5">
          <SectionLabel>Points by programme</SectionLabel>
          {data.byProgram.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--ink-faint)]">No enrollments credited yet this year. Convert leads to start earning.</div>
          ) : (
            <div className="space-y-3">
              {data.byProgram.map((p: any) => (
                <div key={p.code} className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-[var(--ink)]">{p.name}</div>
                    <div className="text-xs text-[var(--ink-faint)]">{p.count} student{p.count === 1 ? '' : 's'}</div>
                  </div>
                  <div className="font-display text-lg font-semibold text-[var(--accent)]">{p.points} pts</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Delivery split + rank ladder */}
        <Card className="p-5">
          <SectionLabel>Delivery mix</SectionLabel>
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-[var(--line-soft)] rounded-lg p-4 text-center">
              <div className="font-display text-2xl font-semibold text-[var(--ink)]">{data.byDelivery.in_person}</div>
              <div className="text-xs text-[var(--ink-faint)] mt-1">In person</div>
            </div>
            <div className="bg-[var(--line-soft)] rounded-lg p-4 text-center">
              <div className="font-display text-2xl font-semibold text-[var(--ink)]">{data.byDelivery.online}</div>
              <div className="text-xs text-[var(--ink-faint)] mt-1">Online</div>
            </div>
          </div>
          <SectionLabel>Total this year</SectionLabel>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-semibold text-[var(--ink)]">{formatGHS(data.grossSalary + data.registrationCommission)}</span>
            <span className="text-xs text-[var(--ink-faint)]">salary + registration commission</span>
          </div>
        </Card>
      </div>
    </div>
  )
}

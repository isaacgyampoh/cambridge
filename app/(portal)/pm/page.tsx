'use client'
import { useState, useEffect } from 'react'
import { StatCard, Card, Spinner } from '@/components/ui'
import { DataTable, type Column } from '@/components/ui/DataTable'
import Link from 'next/link'

type TeamMember = {
  id: string
  full_name: string
  tier?: string | null
  leads: number
  converted: number
  rate: number
}

export default function PMDashboard() {
  const [s, setS] = useState<any>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    fetch('/api/pm/dashboard').then(r => r.json()).then(setS).catch(() => setS({}))
    fetch('/api/auth/me').then(r => r.json()).then(d => setName((d.fullName || '').split(' ')[0])).catch(() => {})
  }, [])

  if (!s) return <div className="py-20"><Spinner /></div>

  const teamColumns: Column<TeamMember>[] = [
    { key: 'name', header: 'Name', primary: true, render: m => m.full_name },
    {
      key: 'tier', header: 'Tier', secondary: true,
      render: m => <span className="capitalize">{m.tier || 'mid'}</span>,
    },
    { key: 'leads', header: 'Leads', numeric: true, render: m => m.leads },
    {
      key: 'converted', header: 'Converted', numeric: true,
      render: m => <span className="font-semibold text-[var(--ok)]">{m.converted}</span>,
    },
    { key: 'rate', header: 'Rate', numeric: true, render: m => `${m.rate}%` },
  ]

  return (
    <div className="fade-in w-full">
      <div className="mb-8">
        <h1 className="font-display text-[24px] sm:text-[24px] font-semibold text-[var(--ink)]">{name ? `Welcome, ${name}` : 'Team overview'}</h1>
        <p className="text-[var(--ink-soft)] text-[15px] mt-1.5">How the team and pipeline are doing across the centre.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Total leads" value={s.totalLeads ?? 0} sub={`${s.newThisWeek ?? 0} new this week`} />
        <StatCard label="Unassigned" value={s.unassigned ?? 0} sub="Waiting for a marketer" accent={s.unassigned > 0} />
        <StatCard label="Converted" value={s.registered ?? 0} sub={`${s.conversionRate ?? 0}% conversion`} />
        <StatCard label="Registered students" value={s.totalStudents ?? 0} sub={`${s.studentsThisMonth ?? 0} this month`} />
        <StatCard label="Pending admissions" value={s.pendingAdmissions ?? 0} sub="Awaiting processing" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Attention */}
        <Card className="p-6">
          <div className="text-[15px] font-semibold text-[var(--ink)] mb-3">Needs attention</div>
          <div className="space-y-2.5">
            <Row label="Unassigned leads" value={s.unassigned ?? 0} warn={s.unassigned > 0} />
            <Row label="Leads gone quiet (5+ days)" value={s.cold ?? 0} warn={s.cold > 0} />
            <Row label="Pending admissions" value={s.pendingAdmissions ?? 0} warn={s.pendingAdmissions > 0} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/pm/assign" className="h-10 px-4 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold inline-flex items-center">Assign leads</Link>
            <Link href="/pm/prep-activity" className="h-10 px-4 rounded-xl border border-[var(--line)] text-[var(--ink-soft)] text-sm font-medium inline-flex items-center">Team activity</Link>
          </div>
        </Card>

        {/* Team leaderboard */}
        <Card className="p-6">
          <div className="text-[15px] font-semibold text-[var(--ink)] mb-3">Top performers</div>
          {(!s.leaderboard || s.leaderboard.length === 0) ? (
            <p className="text-[14px] text-[var(--ink-soft)]">No conversions recorded yet.</p>
          ) : (
            <div className="space-y-2.5">
              {s.leaderboard.map((m: any, i: number) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-[14px] text-[var(--ink)]"><span className="text-[var(--ink-faint)] mr-2">{i + 1}.</span>{m.name}</span>
                  <span className="text-[13px] text-[var(--ink-soft)]">{m.won} won / {m.total} leads</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Sub-PMs / people reporting to this PM */}
      {s.subTeam && s.subTeam.length > 0 && (
        <Card className="p-6 mt-4">
          <div className="text-[15px] font-semibold text-[var(--ink)] mb-1">Your team</div>
          <p className="text-[13px] text-[var(--ink-soft)] mb-4">People who report to you and everything they're working on.</p>
          <DataTable<TeamMember>
            caption="Your team"
            rows={s.subTeam}
            rowKey={m => m.id}
            columns={teamColumns}
            emptyTitle="Nobody reports to you yet"
            emptyMessage="People assigned to report to you will appear here."
          />
        </Card>
      )}
    </div>
  )
}

function Row({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[14px] text-[var(--ink-soft)]">{label}</span>
      <span className={`text-[15px] font-semibold ${warn ? 'text-[var(--warn)]' : 'text-[var(--ink)]'}`}>{value}</span>
    </div>
  )
}

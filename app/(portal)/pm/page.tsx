'use client'
import { useState, useEffect } from 'react'
import { StatCard, Card, Spinner } from '@/components/ui'
import Link from 'next/link'

export default function PMDashboard() {
  const [s, setS] = useState<any>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    fetch('/api/pm/dashboard').then(r => r.json()).then(setS).catch(() => setS({}))
    fetch('/api/auth/me').then(r => r.json()).then(d => setName((d.fullName || '').split(' ')[0])).catch(() => {})
  }, [])

  if (!s) return <div className="py-20"><Spinner /></div>

  return (
    <div className="fade-in w-full">
      <div className="mb-8">
        <h1 className="font-display text-[28px] sm:text-[32px] font-semibold text-[var(--ink)]">{name ? `Welcome, ${name}` : 'Team overview'}</h1>
        <p className="text-[var(--ink-soft)] text-[15px] mt-1.5">How the team and pipeline are doing across the centre.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Total leads" value={s.totalLeads ?? 0} sub={`${s.newThisWeek ?? 0} new this week`} />
        <StatCard label="Unassigned" value={s.unassigned ?? 0} sub="Waiting for a marketer" accent={s.unassigned > 0} />
        <StatCard label="Converted" value={s.registered ?? 0} sub={`${s.conversionRate ?? 0}% conversion`} />
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
          <div className="overflow-x-auto">
            <table className="rtc w-full text-[14px]">
              <thead>
                <tr className="text-left text-[12px] text-[var(--ink-faint)] border-b border-[var(--line)]">
                  <th className="py-2.5 font-medium">Name</th>
                  <th className="py-2.5 font-medium">Tier</th>
                  <th className="py-2.5 font-medium text-center">Leads</th>
                  <th className="py-2.5 font-medium text-center">Converted</th>
                  <th className="py-2.5 font-medium text-center">Rate</th>
                </tr>
              </thead>
              <tbody>
                {s.subTeam.map((m: any) => (
                  <tr key={m.id} className="border-b border-[var(--line-soft)] last:border-0">
                    <td data-label="Name" className="py-3 font-medium text-[var(--ink)]">{m.full_name}</td>
                    <td data-label="Tier" className="py-3 text-[var(--ink-soft)] capitalize">{m.tier || 'mid'}</td>
                    <td data-label="Leads" className="py-3 text-center text-[var(--ink)]">{m.leads}</td>
                    <td data-label="Converted" className="py-3 text-center font-semibold text-[var(--ok)]">{m.converted}</td>
                    <td data-label="Rate" className="py-3 text-center text-[var(--ink-soft)]">{m.rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

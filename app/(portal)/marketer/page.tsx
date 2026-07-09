'use client'
import { useState, useEffect } from 'react'
import { StatCard, Card, Spinner } from '@/components/ui'
import { formatGHS } from '@/lib/utils'
import Link from 'next/link'

export default function MarketerDashboard() {
  const [s, setS] = useState<any>(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')

  useEffect(() => {
    fetch('/api/marketer/dashboard').then(r => r.json()).then(setS).catch(() => setS({}))
    fetch('/api/auth/me').then(r => r.json()).then(d => { setName((d.fullName || '').split(' ')[0]); setRole(d.role || '') }).catch(() => {})
  }, [])

  if (!s) return <div className="py-20"><Spinner /></div>

  // Only a 100% marketer (marketing_officer) sees the registration-fee amount.
  // Staff who market as a secondary duty do not.
  const showFee = role === 'marketing_officer'

  const greeting = name ? `Welcome back, ${name}` : 'Your dashboard'

  return (
    <div className="fade-in w-full">
      <div className="mb-8">
        <h1 className="font-display text-[28px] sm:text-[32px] font-semibold text-[var(--ink)]">{greeting}</h1>
        <p className="text-[var(--ink-soft)] text-[15px] mt-1.5">Here's how your marketing is going.</p>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Total leads" value={s.totalLeads ?? 0} sub={`${s.newLeads ?? 0} new to work`} spark={s.byDay} />
        <StatCard label="Converted" value={s.registered ?? 0} sub={`${s.conversionRate ?? 0}% conversion`} />
        {showFee
          ? <StatCard label="Registration fees earned" value={formatGHS(s.regFees ?? 0)} sub="Your commission this year" accent />
          : <StatCard label="Points" value={s.points ?? 0} sub="Toward your rank" accent />}
        {showFee && <StatCard label="Points" value={s.points ?? 0} sub="Toward your rank" />}
      </div>

      {/* Attention + quick links */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-6">
          <div className="text-[15px] font-semibold text-[var(--ink)] mb-3">Needs your attention</div>
          {s.cold > 0 ? (
            <p className="text-[14px] text-[var(--ink-soft)] leading-relaxed">
              You have <span className="font-semibold text-[var(--warn)]">{s.cold} lead{s.cold > 1 ? 's' : ''}</span> that have gone quiet for 5+ days. Follow up before they go cold.
            </p>
          ) : (
            <p className="text-[14px] text-[var(--ink-soft)]">You're on top of your leads — nothing gone stale. Keep it up.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/marketer/leads" className="h-10 px-4 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold inline-flex items-center">Work my leads</Link>
            <Link href="/marketer/leads/new" className="h-10 px-4 rounded-xl border border-[var(--line)] text-[var(--ink-soft)] text-sm font-medium inline-flex items-center">Add a lead</Link>
          </div>
        </Card>

        <Card className="p-6">
          <div className="text-[15px] font-semibold text-[var(--ink)] mb-3">Your pipeline</div>
          <div className="space-y-2.5">
            <Row label="New leads to contact" value={s.newLeads ?? 0} />
            <Row label="In conversation" value={s.contacted ?? 0} />
            <Row label="Converted / registered" value={s.registered ?? 0} />
            <Row label="Gone quiet (5+ days)" value={s.cold ?? 0} warn={s.cold > 0} />
          </div>
        </Card>
      </div>
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

'use client'
import { useState, useEffect } from 'react'
import { StatCard, Card, Spinner } from '@/components/ui'
import Link from 'next/link'

export default function AdmissionDashboard() {
  const [s, setS] = useState<any>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    fetch('/api/admission/dashboard').then(r => r.json()).then(setS).catch(() => setS({}))
    fetch('/api/auth/me').then(r => r.json()).then(d => setName((d.fullName || '').split(' ')[0])).catch(() => {})
  }, [])

  if (!s) return <div className="py-20"><Spinner /></div>

  return (
    <div className="fade-in w-full">
      <div className="mb-8">
        <h1 className="font-display text-[28px] sm:text-[32px] font-semibold text-[var(--ink)]">{name ? `Welcome, ${name}` : 'Admissions'}</h1>
        <p className="text-[var(--ink-soft)] text-[15px] mt-1.5">The admissions pipeline at a glance.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Pending" value={s.pending ?? 0} sub="need processing" accent={s.pending > 0} />
        <StatCard label="Awaiting payment/forms" value={s.awaiting ?? 0} sub="in progress" />
        <StatCard label="Admitted" value={s.admitted ?? 0} sub="completed" />
        <StatCard label="New this week" value={s.newThisWeek ?? 0} sub="fresh admissions" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-6">
          <div className="text-[15px] font-semibold text-[var(--ink)] mb-3">Needs attention</div>
          <div className="space-y-2.5">
            <Row label="Pending admissions" value={s.pending ?? 0} warn={s.pending > 0} />
            <Row label="Awaiting payment / forms" value={s.awaiting ?? 0} warn={s.awaiting > 0} />
            <Row label="Unpaid applications" value={s.unpaidApps ?? 0} warn={s.unpaidApps > 0} />
          </div>
          <div className="mt-4">
            <Link href="/admission/process" className="h-10 px-4 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold inline-flex items-center">Process admissions</Link>
          </div>
        </Card>
        <Card className="p-6">
          <div className="text-[15px] font-semibold text-[var(--ink)] mb-3">Pipeline</div>
          <div className="space-y-2.5">
            <Row label="Total admissions" value={s.total ?? 0} />
            <Row label="Total applications" value={s.totalApplications ?? 0} />
            <Row label="Admitted" value={s.admitted ?? 0} />
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

'use client'
import { useState, useEffect } from 'react'
import { StatCard, Card, Spinner } from '@/components/ui'
import Link from 'next/link'

export default function TrainerDashboard() {
  const [s, setS] = useState<any>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    fetch('/api/trainer/dashboard').then(r => r.json()).then(setS).catch(() => setS({}))
    fetch('/api/auth/me').then(r => r.json()).then(d => setName((d.fullName || '').split(' ')[0])).catch(() => {})
  }, [])

  if (!s) return <div className="py-20"><Spinner /></div>

  return (
    <div className="fade-in w-full">
      <div className="mb-8">
        <h1 className="font-display text-[28px] sm:text-[32px] font-semibold text-[var(--ink)]">{name ? `Welcome, ${name}` : 'Your classes'}</h1>
        <p className="text-[var(--ink-soft)] text-[15px] mt-1.5">Your teaching schedule and students at a glance.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="My classes" value={s.totalClasses ?? 0} sub="assigned to me" />
        <StatCard label="Ongoing" value={s.ongoing ?? 0} sub="running now" accent={s.ongoing > 0} />
        <StatCard label="Upcoming" value={s.upcoming ?? 0} sub="starting soon" />
        <StatCard label="Students" value={s.totalStudents ?? 0} sub="across my classes" />
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[15px] font-semibold text-[var(--ink)]">My classes</div>
          <Link href="/trainer/classes" className="text-[13px] text-[var(--accent)] font-medium">Take attendance</Link>
        </div>
        {(!s.classes || s.classes.length === 0) ? (
          <p className="text-[14px] text-[var(--ink-soft)]">No classes assigned to you yet.</p>
        ) : (
          <div className="space-y-2">
            {s.classes.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between py-2.5 border-b border-[var(--line-soft)] last:border-0">
                <div>
                  <div className="text-[14px] font-medium text-[var(--ink)]">{c.name}</div>
                  <div className="text-[13px] text-[var(--ink-faint)]">{c.course}</div>
                </div>
                <span className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${c.status === 'ongoing' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>{c.status}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

'use client'
import { useData } from '@/hooks/useData'
import { useState, useEffect } from 'react'
import {
  Users, TrendingUp, DollarSign, GraduationCap, UserCheck,
  Radio, CalendarCheck, BarChart3, FolderOpen, ArrowUpRight, Kanban,
  UserPlus, CreditCard, ClipboardList, Clock, Activity,
} from 'lucide-react'
import Link from 'next/link'
import { formatGHS } from '@/lib/utils'
import { StatCard, SectionLabel, Card } from '@/components/ui'

const FEED_ICON: Record<string, any> = {
  lead: UserPlus, payment: CreditCard, admission: UserCheck, signin: ClipboardList, attendance: Clock,
}
function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function AdminDashboard() {
  const { data: leads } = useData({ table: 'leads', select: 'id, status, assigned_to, created_at', limit: 500 })
  const { data: admissions } = useData({ table: 'admissions', select: 'id, status', limit: 200 })
  const { data: payments } = useData({ table: 'payments', select: 'amount, status', filters: [{ col: 'status', op: 'eq', val: 'paid' }], limit: 500 })
  const { data: profiles } = useData({ table: 'profiles', select: 'id, role, is_active', limit: 200 })
  const [feed, setFeed] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/activity-feed').then(r => r.ok ? r.json() : { events: [] }).then(d => setFeed(d.events || [])).catch(() => {})
  }, [])

  const today = new Date().toISOString().slice(0, 10)

  // 7-day lead trend (oldest -> newest) for sparklines
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i))
    return d.toISOString().slice(0, 10)
  })
  const leadsByDay = last7.map(day => leads.filter((l: any) => l.created_at?.startsWith(day)).length)
  const admByDay = last7.map(day => admissions.filter((a: any) => a.created_at?.startsWith(day)).length)
  // week-over-week delta
  const thisWeek = leadsByDay.reduce((a, b) => a + b, 0)
  const prevWeekLeads = leads.filter((l: any) => {
    if (!l.created_at) return false
    const d = new Date(l.created_at); const days = (Date.now() - d.getTime()) / 86400000
    return days >= 7 && days < 14
  }).length
  const leadDelta = prevWeekLeads > 0 ? Math.round(((thisWeek - prevWeekLeads) / prevWeekLeads) * 100) : (thisWeek > 0 ? 100 : 0)

  const s = {
    totalLeads: leads.length,
    todayLeads: leads.filter((l: any) => l.created_at?.startsWith(today)).length,
    unassigned: leads.filter((l: any) => !l.assigned_to).length,
    readyToJoin: leads.filter((l: any) => l.status === 'ready_to_join').length,
    admitted: admissions.filter((a: any) => a.status === 'admitted').length,
    totalAdmissions: admissions.length,
    revenue: payments.reduce((a: number, p: any) => a + Number(p.amount), 0),
    activeStaff: profiles.filter((p: any) => p.is_active && p.role !== 'student').length,
  }

  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="fade-in w-full">
      {/* Header */}
      <div className="mb-8">
        <div className="text-[13px] font-medium text-[var(--ink-faint)] mb-2">{dateStr}</div>
        <h1 className="font-display text-[30px] leading-tight font-semibold text-[var(--ink)]">{greeting}</h1>
        <p className="text-[var(--ink-soft)] text-sm mt-1.5">Here is where things stand across the centre today.</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
        <StatCard label="Total leads" value={s.totalLeads} sub={`${s.todayLeads} added today`} icon={<TrendingUp size={18} />} trend={{ value: `${Math.abs(leadDelta)}%`, up: leadDelta >= 0 }} spark={leadsByDay} />
        <StatCard label="Unassigned" value={s.unassigned} sub={s.unassigned > 0 ? 'Need attention' : 'All assigned'} icon={<Users size={18} />} />
        <StatCard label="Ready to join" value={s.readyToJoin} sub="Awaiting admission" icon={<UserCheck size={18} />} spark={admByDay} />
        <StatCard label="Revenue" value={formatGHS(s.revenue)} sub="Collected to date" icon={<DollarSign size={18} />} accent />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard label="Admitted" value={s.admitted} sub={`of ${s.totalAdmissions} cases`} icon={<GraduationCap size={18} />} />
        <StatCard label="Active staff" value={s.activeStaff} sub="Across all roles" icon={<Users size={18} />} />
      </div>

      {/* Navigation sections */}
      {/* Activity feed — full width, clean */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[13px] font-medium text-[var(--ink-faint)]">Recent activity</span>
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent)]" />
        </span>
      </div>
      <Card className="p-1.5">
        {feed.length === 0 ? (
          <div className="py-14 text-center">
            <Activity size={22} className="mx-auto text-[var(--ink-faint)] opacity-40 mb-2" />
            <p className="text-sm text-[var(--ink-faint)]">No activity yet today</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--line-soft)]">
            {feed.map((e, i) => {
              const Icon = FEED_ICON[e.icon] || Activity
              return (
                <div key={i} className="flex items-start gap-3 px-3 py-3.5">
                  <div className="w-9 h-9 rounded-full bg-[var(--line-soft)] flex items-center justify-center flex-shrink-0">
                    <Icon size={15} className="text-[var(--ink-soft)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[var(--ink)] leading-snug">{e.title}</div>
                    {e.sub && <div className="text-xs text-[var(--ink-faint)] truncate mt-0.5">{e.sub}</div>}
                  </div>
                  <span className="text-[12px] text-[var(--ink-faint)] flex-shrink-0 mt-0.5">{timeAgo(e.at)}</span>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

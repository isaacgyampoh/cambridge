'use client'
import { useData } from '@/hooks/useData'
import { Users, TrendingUp, DollarSign, GraduationCap, UserCheck, BookOpen, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { formatGHS } from '@/lib/utils'

export default function AdminDashboard() {
  const { data: leads } = useData({ table: 'leads', select: 'id, status, assigned_to, created_at', limit: 500 })
  const { data: admissions } = useData({ table: 'admissions', select: 'id, status', limit: 200 })
  const { data: payments } = useData({ table: 'payments', select: 'amount, status', filters: [{ col: 'status', op: 'eq', val: 'paid' }], limit: 500 })
  const { data: profiles } = useData({ table: 'profiles', select: 'id, role, is_active', limit: 200 })

  const today = new Date().toISOString().slice(0, 10)
  const stats = {
    totalLeads: leads.length,
    todayLeads: leads.filter(l => l.created_at?.startsWith(today)).length,
    unassigned: leads.filter(l => !l.assigned_to).length,
    readyToJoin: leads.filter(l => l.status === 'ready_to_join').length,
    admitted: admissions.filter(a => a.status === 'admitted').length,
    totalAdmissions: admissions.length,
    revenue: payments.reduce((a, p) => a + Number(p.amount), 0),
    activeStaff: profiles.filter(p => p.is_active && p.role !== 'student').length,
  }

  const quickLinks = [
    { label: 'Lead Pipeline', href: '/admin/pipeline', desc: 'Drag & drop Kanban board', color: 'bg-blue-50 border-blue-100 hover:border-blue-300' },
    { label: 'All Leads', href: '/admin/leads', desc: `${stats.unassigned} unassigned`, color: 'bg-yellow-50 border-yellow-100 hover:border-yellow-300' },
    { label: 'Admissions', href: '/admin/admissions', desc: `${stats.totalAdmissions - stats.admitted} pending`, color: 'bg-indigo-50 border-indigo-100 hover:border-indigo-300' },
    { label: 'Finance', href: '/admin/finance', desc: formatGHS(stats.revenue) + ' revenue', color: 'bg-green-50 border-green-100 hover:border-green-300' },
    { label: 'Broadcast', href: '/admin/broadcast', desc: 'Bulk WhatsApp & SMS', color: 'bg-purple-50 border-purple-100 hover:border-purple-300' },
    { label: 'Attendance', href: '/admin/attendance', desc: 'Live class sign-ins', color: 'bg-orange-50 border-orange-100 hover:border-orange-300' },
    { label: 'Marketers', href: '/admin/marketers', desc: 'Performance monitor', color: 'bg-pink-50 border-pink-100 hover:border-pink-300' },
    { label: 'Documents', href: '/admin/documents', desc: 'PDF templates & letters', color: 'bg-slate-50 border-slate-100 hover:border-slate-300' },
    { label: 'Staff', href: '/admin/staff', desc: `${stats.activeStaff} active staff`, color: 'bg-teal-50 border-teal-100 hover:border-teal-300' },
  ]

  return (
    <div className="fade-in max-w-6xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-400 text-sm">Cambridge Centre of Excellence — System Overview</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Leads', value: stats.totalLeads, sub: `${stats.todayLeads} today`, icon: TrendingUp, color: 'text-blue-600 bg-blue-50' },
          { label: 'Unassigned', value: stats.unassigned, sub: 'Need attention', icon: Users, color: stats.unassigned > 0 ? 'text-yellow-600 bg-yellow-50' : 'text-green-600 bg-green-50' },
          { label: 'Ready to Join', value: stats.readyToJoin, sub: 'Await admission', icon: UserCheck, color: 'text-purple-600 bg-purple-50' },
          { label: 'Revenue', value: formatGHS(stats.revenue), sub: 'All payments', icon: DollarSign, color: 'text-green-600 bg-green-50' },
          { label: 'Admitted', value: stats.admitted, sub: `of ${stats.totalAdmissions} cases`, icon: GraduationCap, color: 'text-indigo-600 bg-indigo-50' },
          { label: 'Active Staff', value: stats.activeStaff, sub: 'All roles', icon: BookOpen, color: 'text-slate-600 bg-slate-50' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <div className={`w-9 h-9 rounded-xl ${s.color.split(' ')[1]} flex items-center justify-center mb-2`}>
              <s.icon size={17} className={s.color.split(' ')[0]} />
            </div>
            <div className="text-xl font-bold text-gray-900">{s.value}</div>
            <div className="text-xs font-medium text-gray-700">{s.label}</div>
            <div className="text-[11px] text-gray-400">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Quick access */}
      <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Quick Access</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {quickLinks.map(l => (
          <Link key={l.href} href={l.href}
            className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all group ${l.color}`}>
            <div>
              <div className="text-sm font-bold text-gray-900 group-hover:text-blue-700 transition-colors">{l.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{l.desc}</div>
            </div>
            <ArrowRight size={16} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  )
}

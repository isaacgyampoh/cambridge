'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Users, TrendingUp, DollarSign, GraduationCap, UserCheck, BookOpen } from 'lucide-react'

export default function AdminDashboard() {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const sb = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    const today = new Date().toISOString().slice(0, 10)
    const [
      { count: totalLeads },
      { count: todayLeads },
      { count: unassigned },
      { count: readyToJoin },
      { count: totalAdmissions },
      { count: admitted },
      { count: totalStaff },
      { data: payments },
    ] = await Promise.all([
      sb.from('leads').select('*', { count: 'exact', head: true }),
      sb.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', today + 'T00:00:00'),
      sb.from('leads').select('*', { count: 'exact', head: true }).is('assigned_to', null),
      sb.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'ready_to_join'),
      sb.from('admissions').select('*', { count: 'exact', head: true }),
      sb.from('admissions').select('*', { count: 'exact', head: true }).eq('status', 'admitted'),
      sb.from('profiles').select('*', { count: 'exact', head: true }).eq('is_active', true),
      sb.from('payments').select('amount').eq('status', 'paid'),
    ])

    const totalRevenue = (payments || []).reduce((a: number, p: any) => a + Number(p.amount), 0)

    setStats({
      totalLeads, todayLeads, unassigned, readyToJoin,
      totalAdmissions, admitted, totalStaff, totalRevenue
    })
    setLoading(false)
  }

  const cards = stats ? [
    { label: 'Total Leads', value: stats.totalLeads, sub: `${stats.todayLeads} today`, icon: TrendingUp, color: 'bg-blue-50 text-blue-600 border-blue-100' },
    { label: 'Unassigned', value: stats.unassigned, sub: 'Needs attention', icon: Users, color: 'bg-yellow-50 text-yellow-600 border-yellow-100' },
    { label: 'Ready to Join', value: stats.readyToJoin, sub: 'Awaiting admission', icon: UserCheck, color: 'bg-purple-50 text-purple-600 border-purple-100' },
    { label: 'Admitted', value: stats.admitted, sub: `of ${stats.totalAdmissions} total`, icon: GraduationCap, color: 'bg-green-50 text-green-600 border-green-100' },
    { label: 'Total Revenue', value: `GHS ${Number(stats.totalRevenue).toLocaleString()}`, sub: 'All time', icon: DollarSign, color: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
    { label: 'Active Staff', value: stats.totalStaff, sub: 'Across all roles', icon: BookOpen, color: 'bg-slate-50 text-slate-600 border-slate-100' },
  ] : []

  return (
    <div className="fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-500 text-sm mt-0.5">System overview — Cambridge Centre of Excellence</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {cards.map(c => (
              <div key={c.label} className={`bg-white rounded-2xl p-5 border ${c.color.split(' ')[2]}`}>
                <div className={`w-11 h-11 rounded-xl ${c.color.split(' ')[0]} flex items-center justify-center mb-4`}>
                  <c.icon size={22} className={c.color.split(' ')[1]} />
                </div>
                <div className="text-2xl font-bold text-gray-900">{c.value}</div>
                <div className="text-sm font-semibold text-gray-700 mt-0.5">{c.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { label: 'Manage Staff', href: '/admin/staff', desc: 'Add or update staff accounts' },
              { label: 'Lead Pipeline', href: '/admin/leads', desc: 'View all leads and assignments' },
              { label: 'All Admissions', href: '/admin/admissions', desc: 'Track every admission case' },
              { label: 'Finance Overview', href: '/admin/finance', desc: 'Revenue, invoices, payments' },
              { label: 'Course Management', href: '/admin/courses', desc: 'Manage courses and batches' },
              { label: 'System Reports', href: '/admin/reports', desc: 'Marketing and finance reports' },
            ].map(l => (
              <a key={l.href} href={l.href}
                className="bg-white rounded-2xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition group">
                <div className="text-sm font-bold text-gray-900 group-hover:text-blue-600 transition">{l.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{l.desc}</div>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'

import { formatGHS } from '@/lib/utils'


async function apiQuery(table: string, select: string, filters?: { col: string; op: string; val: any }[], limit = 2000) {
  const params = new URLSearchParams({ table, select, limit: String(limit) })
  if (filters?.length) params.set('filters', JSON.stringify(filters))
  const res = await fetch(`/api/data?${params}`)
  const json = await res.json()
  return json.data || []
}

export default function AdminReports() {
  const [data, setData] = useState<any>(null)
  const [range, setRange] = useState('30')
  useEffect(() => { load() }, [range])

  async function load() {
    const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString()
    const [leads, admissions, payments, students, batches] = await Promise.all([
      apiQuery('leads', 'source,status,created_at,assigned_to', [{ col: 'created_at', op: 'gte', val: since }]),
      apiQuery('admissions', 'status,created_at', [{ col: 'created_at', op: 'gte', val: since }]),
      apiQuery('payments', 'amount,status,method,paid_at', [{ col: 'created_at', op: 'gte', val: since }]),
      apiQuery('profiles', 'id', [{ col: 'role', op: 'eq', val: 'student' }, { col: 'is_active', op: 'eq', val: true }]),
      apiQuery('batches', 'status,class_type'),
    ])

    const l = leads; const p = payments
    const paidPayments = p.filter((x: any) => x.status === 'paid')
    const bySource: Record<string, number> = {}
    l.forEach((x: any) => { bySource[x.source] = (bySource[x.source] || 0) + 1 })

    const byAdmStatus: Record<string, number> = {}
    admissions.forEach((x: any) => { byAdmStatus[x.status] = (byAdmStatus[x.status] || 0) + 1 })

    setData({
      totalLeads: l.length,
      converted: l.filter((x: any) => ['ready_to_join','registered'].includes(x.status)).length,
      unassigned: l.filter((x: any) => !x.assigned_to).length,
      bySource,
      totalAdmissions: (admissions || []).length,
      admitted: byAdmStatus.admitted || 0,
      byAdmStatus,
      revenue: paidPayments.reduce((a: number, x: any) => a + Number(x.amount), 0),
      txCount: paidPayments.length,
      totalStudents: (students || []).length,
      ongoingBatches: (batches || []).filter((b: any) => b.status === 'ongoing').length,
      upcomingBatches: (batches || []).filter((b: any) => b.status === 'upcoming').length,
    })
  }

  if (!data) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>

  return (
    <div className="fade-in w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Reports</h1>
          <p className="text-gray-500 text-sm mt-0.5">Full ERP analytics overview</p>
        </div>
        <select value={range} onChange={e => setRange(e.target.value)} className="h-10 px-4 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">All time</option>
        </select>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Leads', value: data.totalLeads, sub: `${data.unassigned} unassigned`, color: 'bg-blue-50 text-blue-600' },
          { label: 'Conversion Rate', value: `${data.totalLeads ? Math.round(data.converted/data.totalLeads*100) : 0}%`, sub: `${data.converted} converted`, color: 'bg-green-50 text-green-600' },
          { label: 'Revenue', value: formatGHS(data.revenue), sub: `${data.txCount} transactions`, color: 'bg-emerald-50 text-emerald-600' },
          { label: 'Total Students', value: data.totalStudents, sub: `${data.ongoingBatches} active classes`, color: 'bg-purple-50 text-purple-600' },
          { label: 'Admissions', value: data.totalAdmissions, sub: `${data.admitted} admitted`, color: 'bg-indigo-50 text-indigo-600' },
          { label: 'Ongoing Batches', value: data.ongoingBatches, sub: `${data.upcomingBatches} upcoming`, color: 'bg-orange-50 text-orange-600' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className={`text-2xl font-bold ${k.color.split(' ')[1]}`}>{k.value}</div>
            <div className="text-sm font-semibold text-gray-700 mt-0.5">{k.label}</div>
            <div className="text-xs text-gray-400 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Lead sources */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Leads by Source</h3>
          <div className="space-y-2">
            {Object.entries(data.bySource).sort((a: any, b: any) => b[1] - a[1]).map(([src, cnt]: any) => (
              <div key={src}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="capitalize font-medium text-gray-700">{src}</span>
                  <span className="font-bold">{cnt} ({data.totalLeads ? Math.round(cnt/data.totalLeads*100) : 0}%)</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${data.totalLeads ? Math.round(cnt/data.totalLeads*100) : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Admission pipeline */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Admission Pipeline</h3>
          <div className="space-y-2">
            {Object.entries(data.byAdmStatus).sort((a: any, b: any) => b[1] - a[1]).map(([status, cnt]: any) => (
              <div key={status} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <span className="text-sm capitalize text-gray-700">{status.replace(/_/g,' ')}</span>
                <span className="text-sm font-bold text-gray-900">{cnt}</span>
              </div>
            ))}
            {Object.keys(data.byAdmStatus).length === 0 && <p className="text-xs text-gray-400 text-center py-4">No data</p>}
          </div>
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Quick Actions</h3>
          <div className="space-y-2">
            {[
              { label: 'View all leads', href: '/admin/leads' },
              { label: 'Manage courses', href: '/admin/courses' },
              { label: 'View classes', href: '/admin/classes' },
              { label: 'Manage staff', href: '/admin/staff' },
              { label: 'Finance overview', href: '/admin/finance' },
              { label: 'System settings', href: '/admin/settings' },
            ].map(a => (
              <a key={a.href} href={a.href}
                className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 transition text-sm font-medium text-gray-700 hover:text-blue-600">
                {a.label}
                <span className="text-gray-300">→</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

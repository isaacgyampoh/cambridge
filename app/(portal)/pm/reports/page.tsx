'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatGHS } from '@/lib/utils'

export default function PMReports() {
  const [data, setData] = useState<any>(null)
  const [range, setRange] = useState('30')
  const sb = createClient()

  useEffect(() => { load() }, [range])

  async function load() {
    const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString()

    const [{ data: leads }, { data: marketers }] = await Promise.all([
      sb.from('leads').select('*, assignee:assigned_to(full_name)').gte('created_at', since),
      sb.from('profiles').select('id,full_name').eq('role', 'marketing_officer').eq('is_active', true),
    ])

    const l = leads || []
    const total = l.length
    const bySource: Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    const byMarketer: Record<string, { name: string; total: number; converted: number }> = {}

    l.forEach(lead => {
      bySource[lead.source] = (bySource[lead.source] || 0) + 1
      byStatus[lead.status] = (byStatus[lead.status] || 0) + 1
      if (lead.assigned_to) {
        const name = (lead as any).assignee?.full_name || 'Unknown'
        if (!byMarketer[lead.assigned_to]) byMarketer[lead.assigned_to] = { name, total: 0, converted: 0 }
        byMarketer[lead.assigned_to].total++
        if (['ready_to_join','registered'].includes(lead.status)) byMarketer[lead.assigned_to].converted++
      }
    })

    setData({ total, bySource, byStatus, byMarketer, conversionRate: total ? Math.round((byStatus.ready_to_join || 0) / total * 100) : 0 })
  }

  if (!data) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Marketing Reports</h1>
          <p className="text-gray-500 text-sm mt-0.5">Lead pipeline analytics</p>
        </div>
        <select value={range} onChange={e => setRange(e.target.value)} className="h-10 px-4 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
        </select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Leads', value: data.total },
          { label: 'Conversion Rate', value: `${data.conversionRate}%` },
          { label: 'Ready to Join', value: data.byStatus.ready_to_join || 0 },
          { label: 'Registered', value: data.byStatus.registered || 0 },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-200 p-5 text-center">
            <div className="text-3xl font-bold text-gray-900">{k.value}</div>
            <div className="text-sm text-gray-500 mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* By Source */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Leads by Source</h3>
          <div className="space-y-3">
            {Object.entries(data.bySource).sort((a: any, b: any) => b[1] - a[1]).map(([source, count]: any) => (
              <div key={source}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium capitalize text-gray-700">{source}</span>
                  <span className="font-bold text-gray-900">{count}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.round(count / data.total * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* By Status */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Pipeline Status</h3>
          <div className="space-y-3">
            {Object.entries(data.byStatus).sort((a: any, b: any) => b[1] - a[1]).map(([status, count]: any) => (
              <div key={status}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium capitalize text-gray-700">{status.replace(/_/g,' ')}</span>
                  <span className="font-bold text-gray-900">{count}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.round(count / data.total * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Marketer performance */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-4">Marketer Performance</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                {['Marketer','Assigned','Converted','Conversion Rate'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(data.byMarketer).sort((a: any, b: any) => b.converted - a.converted).map((m: any) => (
                <tr key={m.name} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">{m.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{m.total}</td>
                  <td className="px-4 py-3 text-sm font-bold text-green-600">{m.converted}</td>
                  <td className="px-4 py-3 text-sm font-bold">{m.total ? Math.round(m.converted / m.total * 100) : 0}%</td>
                </tr>
              ))}
              {Object.keys(data.byMarketer).length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">No marketer data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Lead } from '@/types'
import { SOURCE_COLORS, STATUS_COLORS, formatDateTime } from '@/lib/utils'
import { Search, Download } from 'lucide-react'
import Link from 'next/link'

export default function AdminLeads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const sb = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await sb.from('leads')
      .select('*, assignee:assigned_to(full_name), assigner:assigned_by(full_name)')
      .order('created_at', { ascending: false })
      .limit(500)
    setLeads(data || [])
    setLoading(false)
  }

  function exportCSV() {
    const rows = filtered.map(l => [
      l.full_name, l.email || '', l.phone || '', l.source, l.status,
      l.course_interest || '', (l as any).assignee?.full_name || '', formatDateTime(l.created_at)
    ].map(v => `"${v}"`).join(','))
    const csv = 'Name,Email,Phone,Source,Status,Course,Assigned To,Date\n' + rows.join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `cce-leads-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  const filtered = leads.filter(l => {
    const matchSearch = !search || [l.full_name, l.email, l.phone, l.course_interest].some(v => v?.toLowerCase().includes(search.toLowerCase()))
    const matchSource = sourceFilter === 'all' || l.source === sourceFilter
    const matchStatus = statusFilter === 'all' || l.status === statusFilter
    return matchSearch && matchSource && matchStatus
  })

  return (
    <div className="fade-in w-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Leads</h1>
          <p className="text-gray-500 text-sm mt-0.5">{filtered.length} of {leads.length} leads</p>
        </div>
        <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition">
          <Download size={15} /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex-1 min-w-48 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, phone..."
            className="w-full h-10 pl-9 pr-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          className="h-10 px-4 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none">
          <option value="all">All Sources</option>
          {['facebook','google','linkedin','website','referral','manual'].map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-10 px-4 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none">
          <option value="all">All Statuses</option>
          {['new','contacted','interested','follow_up','ready_to_join','registered','not_interested','lost'].map(s => (
            <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Name','Phone','Source','Course','Status','Assigned To','Date'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(l => (
                  <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <Link href={`/admin/leads/${l.id}`} className="font-semibold text-sm text-blue-600 hover:underline">{l.full_name}</Link>
                      <div className="text-xs text-gray-400">{l.email}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{l.phone || '—'}</td>
                    <td className="px-4 py-3"><span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${SOURCE_COLORS[l.source]}`}>{l.source}</span></td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-32 truncate">{l.course_interest || '—'}</td>
                    <td className="px-4 py-3"><span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[l.status]}`}>{l.status.replace(/_/g,' ')}</span></td>
                    <td className="px-4 py-3 text-sm text-gray-600">{(l as any).assignee?.full_name || <span className="text-yellow-600 text-xs font-semibold">Unassigned</span>}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDateTime(l.created_at)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">No leads found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

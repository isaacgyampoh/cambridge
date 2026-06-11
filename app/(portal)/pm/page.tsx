'use client'
import { useState } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { toast } from 'sonner'
import { SOURCE_COLORS, STATUS_COLORS } from '@/lib/utils'
import { Users, TrendingUp, UserCheck, Clock, RefreshCw, Search } from 'lucide-react'
import Link from 'next/link'

export default function PMDashboard() {
  const [filter, setFilter] = useState<'unassigned'|'all'|'today'>('unassigned')
  const [assigning, setAssigning] = useState<string|null>(null)
  const [search, setSearch] = useState('')

  const { data: leads, loading, refetch } = useData({
    table: 'leads',
    select: '*, assignee:assigned_to(full_name, email)',
    orderBy: 'created_at', limit: 300,
  })

  const { data: marketers } = useData({
    table: 'profiles',
    select: 'id, full_name, email, phone',
    filters: [{ col: 'role', op: 'eq', val: 'marketing_officer' }, { col: 'is_active', op: 'eq', val: true }],
    orderBy: 'full_name', orderAsc: true,
  })

  async function assignLead(leadId: string, marketerId: string) {
    if (!marketerId) return
    setAssigning(leadId)
    try {
      await mutate('PATCH', 'leads',
        { assigned_to: marketerId, assigned_at: new Date().toISOString() },
        [{ col: 'id', val: leadId }]
      )
      await fetch('/api/leads/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, marketerId }),
      })
      toast.success('Lead assigned! Marketer notified via SMS & WhatsApp.')
      refetch()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAssigning(null)
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const stats = {
    total: leads.length,
    unassigned: leads.filter(l => !l.assigned_to).length,
    today: leads.filter(l => l.created_at?.startsWith(today)).length,
    readyToJoin: leads.filter(l => l.status === 'ready_to_join').length,
  }

  const filtered = leads.filter(l => {
    const matchFilter = filter === 'all' ? true : filter === 'unassigned' ? !l.assigned_to : l.created_at?.startsWith(today)
    const matchSearch = !search || l.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      l.phone?.includes(search) || l.email?.toLowerCase().includes(search.toLowerCase())
    return matchFilter && matchSearch
  })

  return (
    <div className="fade-in max-w-7xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lead Inbox</h1>
          <p className="text-gray-400 text-sm">Manage and assign incoming leads</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search..." className="h-9 pl-8 pr-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500 w-40" />
          </div>
          <button onClick={refetch} className="h-9 w-9 flex items-center justify-center bg-white border border-gray-200 text-gray-500 rounded-xl hover:bg-gray-50 transition">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Leads', value: stats.total, icon: Users, color: 'text-blue-600 bg-blue-50' },
          { label: 'Unassigned', value: stats.unassigned, icon: Clock, color: 'text-yellow-600 bg-yellow-50' },
          { label: 'Today', value: stats.today, icon: TrendingUp, color: 'text-green-600 bg-green-50' },
          { label: 'Ready to Join', value: stats.readyToJoin, icon: UserCheck, color: 'text-purple-600 bg-purple-50' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className={`w-9 h-9 rounded-xl ${s.color.split(' ')[1]} flex items-center justify-center mb-2`}>
              <s.icon size={17} className={s.color.split(' ')[0]} />
            </div>
            <div className="text-xl font-bold text-gray-900">{s.value}</div>
            <div className="text-xs text-gray-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-4">
        {[
          { key: 'unassigned', label: `Unassigned (${stats.unassigned})` },
          { key: 'today', label: `Today (${stats.today})` },
          { key: 'all', label: `All (${stats.total})` },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key as any)}
            className={`px-4 h-9 rounded-xl text-sm font-semibold transition ${filter===f.key?'bg-gray-900 text-white':'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Lead','Contact','Source','Course','Status','Assign To','Date'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-16 text-gray-300">
                    <Users size={32} className="mx-auto mb-2 opacity-50" />
                    <p>No leads in this view</p>
                  </td></tr>
                ) : filtered.map(lead => (
                  <tr key={lead.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/pm/leads/${lead.id}`} className="font-semibold text-sm text-blue-600 hover:underline">
                        {lead.full_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-gray-600">{lead.phone || '—'}</div>
                      <div className="text-[11px] text-gray-400">{lead.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${SOURCE_COLORS[lead.source]||'bg-gray-100 text-gray-600'}`}>
                        {lead.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-32 truncate">{lead.course_interest || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[lead.status]||'bg-gray-100 text-gray-600'}`}>
                        {lead.status?.replace(/_/g,' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {(lead as any).assignee ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-white text-[9px] font-bold">
                            {(lead as any).assignee.full_name?.charAt(0)}
                          </div>
                          <span className="text-xs text-gray-700">{(lead as any).assignee.full_name?.split(' ')[0]}</span>
                        </div>
                      ) : (
                        <select onChange={e => { if(e.target.value) assignLead(lead.id, e.target.value) }}
                          disabled={assigning === lead.id} defaultValue=""
                          className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-500 disabled:opacity-50 max-w-36">
                          <option value="" disabled>Assign to...</option>
                          {marketers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-gray-400">
                      {new Date(lead.created_at).toLocaleDateString('en-GH', { day:'numeric', month:'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

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
    <div className="fade-in w-full">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-2">Pipeline</div>
          <h1 className="font-display text-[28px] leading-tight font-semibold text-[var(--ink)]">Lead inbox</h1>
          <p className="text-[var(--ink-soft)] text-sm mt-1.5">Manage and assign incoming leads.</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search" className="h-10 pl-8 pr-3 rounded-lg border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] w-44" />
          </div>
          <button onClick={refetch} className="h-10 w-10 flex items-center justify-center bg-white border border-[var(--line)] text-[var(--ink-soft)] rounded-lg hover:border-[var(--ink-faint)] transition">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total leads', value: stats.total, icon: Users, accent: false },
          { label: 'Unassigned', value: stats.unassigned, icon: Clock, accent: true },
          { label: 'Today', value: stats.today, icon: TrendingUp, accent: false },
          { label: 'Ready to join', value: stats.readyToJoin, icon: UserCheck, accent: false },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-5 border ${s.accent ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'bg-[var(--paper)] border-[var(--line)]'}`}>
            <div className="flex items-start justify-between">
              <div className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${s.accent ? 'text-white/70' : 'text-[var(--ink-faint)]'}`}>{s.label}</div>
              <s.icon size={17} className={s.accent ? 'text-white/50' : 'text-[var(--ink-faint)]'} />
            </div>
            <div className={`font-display text-[28px] font-semibold mt-3 leading-none ${s.accent ? 'text-white' : 'text-[var(--ink)]'}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-[var(--line-soft)] rounded-lg p-1 w-fit">
        {[
          { key: 'unassigned', label: `Unassigned (${stats.unassigned})` },
          { key: 'today', label: `Today (${stats.today})` },
          { key: 'all', label: `All (${stats.total})` },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key as any)}
            className={`px-4 h-8 rounded-md text-[13px] font-medium transition ${filter===f.key?'bg-white text-[var(--ink)] shadow-sm':'text-[var(--ink-faint)] hover:text-[var(--ink)]'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--line-soft)] border-b border-[var(--line-soft)]">
                <tr>
                  {['Lead','Contact','Source','Course','Status','Assign To','Date'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-16 text-[var(--ink-faint)]">
                    <Users size={32} className="mx-auto mb-2 opacity-50" />
                    <p>No leads in this view</p>
                  </td></tr>
                ) : filtered.map(lead => (
                  <tr key={lead.id} className="border-t border-[var(--line-soft)] hover:bg-[var(--line-soft)] transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/pm/leads/${lead.id}`} className="font-semibold text-sm text-[var(--accent)] hover:underline">
                        {lead.full_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-[var(--ink-soft)]">{lead.phone || '—'}</div>
                      <div className="text-[11px] text-[var(--ink-faint)]">{lead.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${SOURCE_COLORS[lead.source]||'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
                        {lead.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--ink-soft)] max-w-32 truncate">{lead.course_interest || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[lead.status]||'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
                        {lead.status?.replace(/_/g,' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {(lead as any).assignee ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-[9px] font-bold">
                            {(lead as any).assignee.full_name?.charAt(0)}
                          </div>
                          <span className="text-xs text-[var(--ink-soft)]">{(lead as any).assignee.full_name?.split(' ')[0]}</span>
                        </div>
                      ) : (
                        <select onChange={e => { if(e.target.value) assignLead(lead.id, e.target.value) }}
                          disabled={assigning === lead.id} defaultValue=""
                          className="text-xs px-2 py-1.5 border border-[var(--line)] rounded-lg bg-white focus:outline-none focus:border-[var(--accent)] disabled:opacity-50 max-w-36">
                          <option value="" disabled>Assign to...</option>
                          {marketers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-[var(--ink-faint)]">
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

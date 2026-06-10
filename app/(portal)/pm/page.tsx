'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Lead, Profile } from '@/types'
import { toast } from 'sonner'
import { Users, TrendingUp, UserCheck, Clock, RefreshCw } from 'lucide-react'

const SOURCE_COLORS: Record<string, string> = {
  facebook: 'bg-blue-100 text-blue-700',
  google: 'bg-red-100 text-red-700',
  linkedin: 'bg-blue-900/20 text-blue-800',
  website: 'bg-purple-100 text-purple-700',
  referral: 'bg-green-100 text-green-700',
  manual: 'bg-gray-100 text-gray-700',
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-yellow-100 text-yellow-800',
  contacted: 'bg-blue-100 text-blue-700',
  interested: 'bg-indigo-100 text-indigo-700',
  follow_up: 'bg-orange-100 text-orange-700',
  ready_to_join: 'bg-green-100 text-green-700',
  registered: 'bg-emerald-100 text-emerald-700',
  not_interested: 'bg-red-100 text-red-600',
  lost: 'bg-gray-100 text-gray-600',
}

export default function PMDashboard() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [marketers, setMarketers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState<string | null>(null)
  const [filter, setFilter] = useState<'unassigned' | 'all' | 'today'>('unassigned')
  const [stats, setStats] = useState({ total: 0, unassigned: 0, today: 0, readyToJoin: 0 })
  const sb = createClient()

  useEffect(() => {
    load()
    // Realtime — new leads
    const channel = sb.channel('pm-leads')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, () => {
        load()
        toast.info('New lead received!')
      })
      .subscribe()
    return () => { sb.removeChannel(channel) }
  }, [])

  async function load() {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)

    const [{ data: leadsData }, { data: mktrs }] = await Promise.all([
      sb.from('leads').select('*, assignee:assigned_to(full_name,email,role)')
        .order('created_at', { ascending: false }).limit(200),
      sb.from('profiles').select('*').eq('role', 'marketing_officer').eq('is_active', true),
    ])

    const l = leadsData || []
    setLeads(l)
    setMarketers(mktrs || [])
    setStats({
      total: l.length,
      unassigned: l.filter(x => !x.assigned_to).length,
      today: l.filter(x => x.created_at?.startsWith(today)).length,
      readyToJoin: l.filter(x => x.status === 'ready_to_join').length,
    })
    setLoading(false)
  }

  async function assignLead(leadId: string, marketerId: string) {
    if (!marketerId) return
    setAssigning(leadId)

    const { data: { user } } = await sb.auth.getUser()
    const marketer = marketers.find(m => m.id === marketerId)

    const { error } = await sb.from('leads').update({
      assigned_to: marketerId,
      assigned_by: user?.id,
      assigned_at: new Date().toISOString(),
    }).eq('id', leadId)

    if (error) { toast.error('Failed to assign lead'); setAssigning(null); return }

    // Create notification for marketer
    if (marketer) {
      const lead = leads.find(l => l.id === leadId)
      await sb.from('notifications').insert({
        user_id: marketerId,
        type: 'assignment',
        title: 'New lead assigned',
        body: `${lead?.full_name} has been assigned to you. Contact them as soon as possible.`,
        data: { lead_id: leadId },
      })

      // Trigger SMS + WhatsApp via API
      await fetch('/api/leads/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, marketerId }),
      })
    }

    toast.success('Lead assigned successfully!')
    setAssigning(null)
    load()
  }

  const filtered = leads.filter(l => {
    if (filter === 'unassigned') return !l.assigned_to
    if (filter === 'today') return l.created_at?.startsWith(new Date().toISOString().slice(0, 10))
    return true
  })

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lead Inbox</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage and assign incoming leads</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition">
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Leads', value: stats.total, icon: Users, color: 'bg-blue-50 text-blue-600' },
          { label: 'Unassigned', value: stats.unassigned, icon: Clock, color: 'bg-yellow-50 text-yellow-600' },
          { label: 'Today', value: stats.today, icon: TrendingUp, color: 'bg-green-50 text-green-600' },
          { label: 'Ready to Join', value: stats.readyToJoin, icon: UserCheck, color: 'bg-purple-50 text-purple-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-200">
            <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center mb-3`}>
              <s.icon size={20} />
            </div>
            <div className="text-2xl font-bold text-gray-900">{s.value}</div>
            <div className="text-sm text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {[
          { key: 'unassigned', label: `Unassigned (${stats.unassigned})` },
          { key: 'today', label: `Today (${stats.today})` },
          { key: 'all', label: `All (${stats.total})` },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key as any)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
              filter === f.key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Leads table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Users size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No leads found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Name', 'Phone', 'Source', 'Course Interest', 'Status', 'Assign To', 'Date'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(lead => (
                  <tr key={lead.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-sm text-gray-900">{lead.full_name}</div>
                      <div className="text-xs text-gray-400">{lead.email}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{lead.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${SOURCE_COLORS[lead.source] || 'bg-gray-100 text-gray-600'}`}>
                        {lead.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{lead.course_interest || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[lead.status]}`}>
                        {lead.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {(lead as any).assignee ? (
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                            {(lead as any).assignee.full_name?.charAt(0)}
                          </div>
                          <span className="text-xs text-gray-700">{(lead as any).assignee.full_name?.split(' ')[0]}</span>
                        </div>
                      ) : (
                        <select
                          onChange={e => assignLead(lead.id, e.target.value)}
                          disabled={assigning === lead.id}
                          defaultValue=""
                          className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 disabled:opacity-50 bg-white"
                        >
                          <option value="" disabled>Assign to...</option>
                          {marketers.map(m => (
                            <option key={m.id} value={m.id}>{m.full_name}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {new Date(lead.created_at).toLocaleDateString('en-GH', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                      })}
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

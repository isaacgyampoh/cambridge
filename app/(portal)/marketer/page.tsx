'use client'
import { useState, useEffect } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { toast } from 'sonner'
import { STATUS_COLORS } from '@/lib/utils'
import { Phone, MessageSquare, ChevronDown, ChevronUp, Plus, Clock } from 'lucide-react'
import Link from 'next/link'

const STATUSES = [
  { key: 'contacted', label: 'Contacted', color: 'bg-blue-100 text-blue-700' },
  { key: 'interested', label: 'Interested', color: 'bg-indigo-100 text-indigo-700' },
  { key: 'follow_up', label: 'Follow Up', color: 'bg-orange-100 text-orange-700' },
  { key: 'ready_to_join', label: '🚀 Ready to Join', color: 'bg-green-100 text-green-700' },
  { key: 'not_interested', label: 'Not Interested', color: 'bg-red-100 text-red-600' },
  { key: 'lost', label: 'Lost', color: 'bg-gray-100 text-gray-600' },
]

export default function MarketerDashboard() {
  const [myId, setMyId] = useState<string|null>(null)
  const [expanded, setExpanded] = useState<string|null>(null)
  const [updating, setUpdating] = useState<string|null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(s => { if (s.valid) setMyId(s.userId) })
  }, [])

  const { data: leads, loading, refetch } = useData({
    table: 'leads',
    select: '*',
    filters: myId ? [{ col: 'assigned_to', op: 'eq', val: myId }] : [],
    orderBy: 'updated_at',
    enabled: !!myId,
  })

  async function updateStatus(leadId: string, newStatus: string) {
    setUpdating(leadId)
    try {
      await mutate('PATCH', 'leads', { status: newStatus }, [{ col: 'id', val: leadId }])
      if (newStatus === 'ready_to_join') {
        await fetch('/api/admissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId }) })
        toast.success('🚀 Moved to Ready to Join — Admissions team notified!')
      } else {
        toast.success(`Status → ${newStatus.replace(/_/g,' ')}`)
      }
      if (note.trim() && myId) {
        await mutate('POST', 'lead_activities', {
          lead_id: leadId, activity_type: 'note',
          subject: `Status → ${newStatus}`, description: note, created_by: myId,
        })
        setNote('')
      }
      setExpanded(null)
      refetch()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setUpdating(null)
    }
  }

  const byStatus: Record<string, any[]> = {}
  leads.forEach(l => { byStatus[l.status] = [...(byStatus[l.status]||[]), l] })

  const statusOrder = ['new','contacted','interested','follow_up','ready_to_join','not_interested','lost','registered']
  const COLORS: Record<string,string> = {
    new:'bg-yellow-100 text-yellow-800', contacted:'bg-blue-100 text-blue-700',
    interested:'bg-indigo-100 text-indigo-700', follow_up:'bg-orange-100 text-orange-700',
    ready_to_join:'bg-green-100 text-green-700', registered:'bg-emerald-100 text-emerald-700',
    not_interested:'bg-red-100 text-red-600', lost:'bg-gray-100 text-gray-600',
  }

  return (
    <div className="fade-in max-w-3xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Leads</h1>
          <p className="text-gray-400 text-sm">{leads.length} assigned to you</p>
        </div>
        <div className="flex gap-2">
          <Link href="/marketer/activities"
            className="flex items-center gap-1.5 h-9 px-3 bg-orange-50 border border-orange-200 text-orange-700 rounded-xl text-sm font-semibold hover:bg-orange-100 transition">
            <Clock size={14} /> Follow-ups
          </Link>
          <Link href="/marketer/link"
            className="flex items-center gap-1.5 h-9 px-3 bg-white border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50 transition">
            My Link
          </Link>
        </div>
      </div>

      {/* Mini pipeline */}
      <div className="grid grid-cols-4 lg:grid-cols-7 gap-1.5 mb-5">
        {statusOrder.filter(s => byStatus[s]?.length > 0).map(s => (
          <div key={s} className={`rounded-xl p-2 text-center ${COLORS[s]}`}>
            <div className="text-lg font-black">{byStatus[s]?.length}</div>
            <div className="text-[9px] font-semibold capitalize leading-tight mt-0.5">{s.replace(/_/g,' ')}</div>
          </div>
        ))}
      </div>

      {/* Lead list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : leads.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center text-gray-300">
          <p className="font-medium">No leads assigned yet</p>
          <p className="text-sm mt-1">The project manager will assign leads to you</p>
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map(lead => {
            const isExpanded = expanded === lead.id
            return (
              <div key={lead.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                {/* Header row */}
                <div className="flex items-center px-4 py-3 cursor-pointer"
                  onClick={() => setExpanded(isExpanded ? null : lead.id)}>
                  <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0 mr-3">
                    {lead.full_name?.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-gray-900 truncate">{lead.full_name}</div>
                    <div className="text-[11px] text-gray-400">{lead.phone} {lead.course_interest ? `· ${lead.course_interest}` : ''}</div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mx-2 flex-shrink-0 ${COLORS[lead.status]||'bg-gray-100 text-gray-600'}`}>
                    {lead.status?.replace(/_/g,' ')}
                  </span>
                  {isExpanded ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
                </div>

                {/* Expanded actions */}
                {isExpanded && (
                  <div className="border-t border-gray-50 bg-gray-50 px-4 py-3">
                    {/* Quick contact */}
                    {lead.phone && (
                      <div className="flex gap-2 mb-3">
                        <a href={`tel:${lead.phone}`}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-xl text-xs font-semibold hover:bg-green-700 transition">
                          <Phone size={12} /> Call
                        </a>
                        <a href={`https://wa.me/${String(lead.phone).replace(/^0/,'233').replace(/\D/,'')}?text=${encodeURIComponent(`Hello ${lead.full_name?.split(' ')[0]}, this is from Cambridge Centre of Excellence...`)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#25D366] text-white rounded-xl text-xs font-semibold hover:opacity-90 transition">
                          <MessageSquare size={12} /> WhatsApp
                        </a>
                        <Link href={`/marketer/leads/${lead.id}`}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-xl text-xs font-semibold hover:bg-gray-100 transition">
                          Full View →
                        </Link>
                      </div>
                    )}

                    {/* Note */}
                    <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                      placeholder="Note about this interaction..."
                      className="w-full text-xs px-3 py-2 border border-gray-200 rounded-xl resize-none focus:outline-none focus:border-blue-500 bg-white mb-2" />

                    {/* Status buttons */}
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[10px] font-bold text-gray-400 uppercase self-center mr-1">Move to:</span>
                      {STATUSES.filter(s => s.key !== lead.status).map(s => (
                        <button key={s.key} disabled={updating === lead.id}
                          onClick={() => updateStatus(lead.id, s.key)}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-xl border transition hover:opacity-80 disabled:opacity-40 ${s.color}`}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

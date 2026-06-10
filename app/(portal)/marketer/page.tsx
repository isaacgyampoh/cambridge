'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Lead, Profile } from '@/types'
import { toast } from 'sonner'
import { Phone, MessageSquare, Plus, ChevronRight } from 'lucide-react'

const STATUSES = [
  { key: 'new', label: 'New', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  { key: 'contacted', label: 'Contacted', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { key: 'interested', label: 'Interested', color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  { key: 'follow_up', label: 'Follow Up', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { key: 'ready_to_join', label: 'Ready to Join', color: 'bg-green-100 text-green-700 border-green-200' },
  { key: 'not_interested', label: 'Not Interested', color: 'bg-red-100 text-red-600 border-red-200' },
  { key: 'lost', label: 'Lost', color: 'bg-gray-100 text-gray-600 border-gray-200' },
]

export default function MarketerDashboard() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [selected, setSelected] = useState<Lead | null>(null)
  const [note, setNote] = useState('')
  const [updating, setUpdating] = useState(false)
  const [loading, setLoading] = useState(true)
  const sb = createClient()

  useEffect(() => {
    async function init() {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return
      const { data: p } = await sb.from('profiles').select('*').eq('id', user.id).single()
      setProfile(p)
      loadLeads(user.id)
    }
    init()
  }, [])

  async function loadLeads(userId: string) {
    setLoading(true)
    const { data } = await sb.from('leads')
      .select('*')
      .eq('assigned_to', userId)
      .order('created_at', { ascending: false })
    setLeads(data || [])
    setLoading(false)
  }

  async function updateStatus(leadId: string, newStatus: string) {
    setUpdating(true)
    const { error } = await sb.from('leads').update({ status: newStatus }).eq('id', leadId)
    if (error) { toast.error('Failed to update status'); setUpdating(false); return }

    // If ready to join — trigger admission flow
    if (newStatus === 'ready_to_join') {
      await fetch('/api/admissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })
      toast.success('Status updated! Admission team notified.')
    } else {
      toast.success('Status updated')
    }

    // Log activity if note
    if (note && profile) {
      await sb.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'note',
        subject: `Status changed to ${newStatus}`,
        description: note,
        created_by: profile.id,
      })
    }

    setNote('')
    setUpdating(false)
    if (profile) loadLeads(profile.id)
    setSelected(null)
  }

  async function logCall(leadId: string) {
    if (!profile) return
    await sb.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'call',
      subject: 'Call logged',
      description: note || 'Called lead',
      created_by: profile.id,
    })
    toast.success('Call logged')
    setNote('')
  }

  const byStatus: Record<string, Lead[]> = {}
  leads.forEach(l => {
    if (!byStatus[l.status]) byStatus[l.status] = []
    byStatus[l.status].push(l)
  })

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Leads</h1>
          <p className="text-gray-500 text-sm mt-0.5">{leads.length} leads assigned to you</p>
        </div>
      </div>

      {/* Pipeline overview */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-6">
        {STATUSES.map(s => (
          <div key={s.key} className={`rounded-xl p-3 border text-center ${s.color}`}>
            <div className="text-xl font-bold">{byStatus[s.key]?.length || 0}</div>
            <div className="text-[11px] font-semibold mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Lead cards */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" />
        </div>
      ) : leads.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
          <p className="font-medium">No leads assigned yet</p>
          <p className="text-sm mt-1">The project manager will assign leads to you</p>
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map(lead => {
            const s = STATUSES.find(x => x.key === lead.status)
            return (
              <div key={lead.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="p-4 flex items-center justify-between cursor-pointer"
                  onClick={() => setSelected(selected?.id === lead.id ? null : lead)}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0">
                      {lead.full_name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 text-sm">{lead.full_name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{lead.phone} · {lead.course_interest || 'No course specified'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${s?.color}`}>
                      {s?.label}
                    </span>
                    <ChevronRight size={16} className={`text-gray-400 transition-transform ${selected?.id === lead.id ? 'rotate-90' : ''}`} />
                  </div>
                </div>

                {/* Expanded actions */}
                {selected?.id === lead.id && (
                  <div className="border-t border-gray-100 p-4 bg-gray-50">
                    <div className="flex gap-2 mb-3">
                      {lead.phone && (
                        <>
                          <a href={`tel:${lead.phone}`}
                            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-xl text-xs font-semibold hover:bg-green-700 transition">
                            <Phone size={14} /> Call
                          </a>
                          <a href={`https://wa.me/${lead.phone.replace(/^0/, '233')}?text=Hello ${encodeURIComponent(lead.full_name)}, I'm calling from Cambridge Centre of Excellence.`}
                            target="_blank"
                            className="flex items-center gap-1.5 px-3 py-2 bg-[#25D366] text-white rounded-xl text-xs font-semibold hover:opacity-90 transition">
                            <MessageSquare size={14} /> WhatsApp
                          </a>
                        </>
                      )}
                    </div>

                    <textarea
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="Add a note about this interaction..."
                      rows={2}
                      className="w-full text-sm px-3 py-2 border border-gray-200 rounded-xl resize-none focus:outline-none focus:border-blue-500 mb-3"
                    />

                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs font-semibold text-gray-500 self-center">Update status:</span>
                      {STATUSES.filter(s => s.key !== lead.status).map(s => (
                        <button key={s.key}
                          disabled={updating}
                          onClick={() => updateStatus(lead.id, s.key)}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition hover:opacity-80 disabled:opacity-50 ${s.color}`}>
                          {s.label}
                        </button>
                      ))}
                    </div>

                    <button onClick={() => logCall(lead.id)}
                      className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition">
                      <Plus size={12} /> Log call
                    </button>
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

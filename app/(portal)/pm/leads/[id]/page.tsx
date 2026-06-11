'use client'
import { useState, useEffect, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime, formatPhone, SOURCE_COLORS, STATUS_COLORS } from '@/lib/utils'
import type { Lead, LeadActivity, LeadStatusLog, Profile } from '@/types'
import { toast } from 'sonner'
import { ArrowLeft, Phone, MessageSquare, Mail, MapPin, BookOpen, Clock } from 'lucide-react'
import Link from 'next/link'

const STATUSES = ['new','contacted','interested','follow_up','ready_to_join','registered','not_interested','lost']

export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [lead, setLead] = useState<Lead | null>(null)
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [logs, setLogs] = useState<LeadStatusLog[]>([])
  const [marketers, setMarketers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState('')
  const sb = createClient()

  useEffect(() => { load() }, [id])

  async function load() {
    const [{ data: l }, { data: a }, { data: lg }, { data: m }] = await Promise.all([
      sb.from('leads').select('*, assignee:assigned_to(full_name,email,phone,role)').eq('id', id).single(),
      sb.from('lead_activities').select('*, creator:created_by(full_name)').eq('lead_id', id).order('created_at', { ascending: false }),
      sb.from('lead_status_logs').select('*, changer:changed_by(full_name)').eq('lead_id', id).order('created_at', { ascending: false }),
      sb.from('profiles').select('*').eq('role', 'marketing_officer').eq('is_active', true),
    ])
    setLead(l); setActivities(a || []); setLogs(lg || []); setMarketers(m || [])
    setLoading(false)
  }

  async function addNote() {
    if (!note.trim()) return
    const { data: { user } } = await sb.auth.getUser()
    await sb.from('lead_activities').insert({ lead_id: id, activity_type: 'note', subject: 'Note', description: note, created_by: user?.id })
    toast.success('Note added')
    setNote('')
    load()
  }

  async function reassign(marketerId: string) {
    const { data: { user } } = await sb.auth.getUser()
    await sb.from('leads').update({ assigned_to: marketerId, assigned_by: user?.id, assigned_at: new Date().toISOString() }).eq('id', id)
    await fetch('/api/leads/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: id, marketerId }) })
    toast.success('Reassigned')
    load()
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
  if (!lead) return <div className="text-center py-20 text-gray-400">Lead not found</div>

  const assignee = (lead as any).assignee

  return (
    <div className="fade-in w-full">
      <Link href="/pm" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-5 transition">
        <ArrowLeft size={16} /> Back to inbox
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left — lead info */}
        <div className="lg:col-span-2 space-y-5">
          {/* Header card */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">
                  {lead.full_name.charAt(0)}
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{lead.full_name}</h1>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[lead.source]}`}>{lead.source}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[lead.status]}`}>{lead.status.replace(/_/g,' ')}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                { icon: Phone, label: 'Phone', value: formatPhone(lead.phone) },
                { icon: Mail, label: 'Email', value: lead.email || '—' },
                { icon: MapPin, label: 'Location', value: [lead.city, lead.country].filter(Boolean).join(', ') || '—' },
                { icon: BookOpen, label: 'Course', value: lead.course_interest || '—' },
                { icon: Clock, label: 'Added', value: formatDateTime(lead.created_at) },
                { icon: Clock, label: 'Assigned', value: formatDateTime(lead.assigned_at) },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-2">
                  <item.icon size={15} className="text-gray-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs text-gray-400">{item.label}</div>
                    <div className="font-medium text-gray-900 break-all">{item.value}</div>
                  </div>
                </div>
              ))}
            </div>

            {lead.phone && (
              <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-xl text-xs font-semibold hover:bg-green-700 transition">
                  <Phone size={13} /> Call
                </a>
                <a href={`https://wa.me/${lead.phone.replace(/^0/, '233')}`} target="_blank"
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#25D366] text-white rounded-xl text-xs font-semibold hover:opacity-90 transition">
                  <MessageSquare size={13} /> WhatsApp
                </a>
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition">
                    <Mail size={13} /> Email
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Add note */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Add Note</h3>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Write a note..."
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-xl resize-none focus:outline-none focus:border-blue-500 mb-2" />
            <button onClick={addNote} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition">
              Save Note
            </button>
          </div>

          {/* Activity timeline */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-4">Activity Timeline</h3>
            {activities.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No activities yet</p>
            ) : (
              <div className="space-y-3">
                {activities.map(a => (
                  <div key={a.id} className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-blue-600">{a.activity_type.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-900">{a.subject}</div>
                      {a.description && <div className="text-xs text-gray-500 mt-0.5">{a.description}</div>}
                      <div className="text-[10px] text-gray-400 mt-0.5">{formatDateTime(a.created_at)} · {(a as any).creator?.full_name || 'System'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right — assignment + status logs */}
        <div className="space-y-5">
          {/* Assignment */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Assignment</h3>
            {assignee ? (
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">{assignee.full_name?.charAt(0)}</div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">{assignee.full_name}</div>
                  <div className="text-xs text-gray-400">{assignee.email}</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 mb-3">Unassigned</p>
            )}
            <select onChange={e => reassign(e.target.value)} defaultValue=""
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-blue-500">
              <option value="" disabled>{assignee ? 'Reassign to...' : 'Assign to...'}</option>
              {marketers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </div>

          {/* Status history */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Status History</h3>
            {logs.length === 0 ? <p className="text-xs text-gray-400">No changes yet</p> : (
              <div className="space-y-2">
                {logs.map(l => (
                  <div key={l.id} className="text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-400 line-through">{l.old_status?.replace(/_/g,' ')}</span>
                      <span className="text-gray-400">→</span>
                      <span className={`font-semibold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[l.new_status]}`}>{l.new_status.replace(/_/g,' ')}</span>
                    </div>
                    <div className="text-gray-400 mt-0.5">{formatDateTime(l.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

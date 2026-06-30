'use client'
import { useState, useEffect, use } from 'react'
import { mutate } from '@/hooks/useData'
import { formatDateTime, formatPhone, SOURCE_COLORS, STATUS_COLORS } from '@/lib/utils'
import type { Lead, LeadActivity, LeadStatusLog, Profile } from '@/types'
import { toast } from 'sonner'
import { ArrowLeft, Phone, MessageSquare, Mail, MapPin, BookOpen, Clock } from 'lucide-react'
import Link from 'next/link'

const STATUSES = ['new','contacted','interested','follow_up','ready_to_join','registered','not_interested','lost']


async function apiQuery(table: string, select: string, filters?: { col: string; op: string; val: any }[], limit = 200) {
  const params = new URLSearchParams({ table, select, limit: String(limit) })
  if (filters?.length) params.set('filters', JSON.stringify(filters))
  const res = await fetch(`/api/data?${params}`)
  const json = await res.json()
  return json.data || []
}

export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [lead, setLead] = useState<Lead | null>(null)
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [logs, setLogs] = useState<LeadStatusLog[]>([])
  const [marketers, setMarketers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState('')
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(s => setUserId(s?.userId || null)).catch(() => {})
    load()
  }, [id])

  async function load() {
    const [leads, a, lg, m] = await Promise.all([
      apiQuery('leads', '*, assignee:assigned_to(full_name,email,phone,role)', [{ col: 'id', op: 'eq', val: id }], 1),
      apiQuery('lead_activities', '*, creator:created_by(full_name)', [{ col: 'lead_id', op: 'eq', val: id }]),
      apiQuery('lead_status_logs', '*, changer:changed_by(full_name)', [{ col: 'lead_id', op: 'eq', val: id }]),
      apiQuery('profiles', '*', [{ col: 'role', op: 'eq', val: 'marketing_officer' }, { col: 'is_active', op: 'eq', val: true }]),
    ])
    setLead(leads[0] || null); setActivities(a); setLogs(lg); setMarketers(m)
    setLoading(false)
  }

  async function addNote() {
    if (!note.trim()) return
    try {
      await mutate('POST', 'lead_activities', { lead_id: id, activity_type: 'note', subject: 'Note', description: note, created_by: userId })
      toast.success('Note added')
      setNote('')
      load()
    } catch (e: any) {
      toast.error(e.message || 'Failed to add note')
    }
  }

  async function reassign(marketerId: string) {
    try {
      await mutate('PATCH', 'leads', { assigned_to: marketerId, assigned_by: userId, assigned_at: new Date().toISOString() }, [{ col: 'id', val: id }])
      await fetch('/api/leads/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: id, marketerId }) })
      toast.success('Reassigned')
      load()
    } catch (e: any) {
      toast.error(e.message || 'Failed to reassign')
    }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
  if (!lead) return <div className="text-center py-20 text-[var(--ink-faint)]">Lead not found</div>

  const assignee = (lead as any).assignee

  return (
    <div className="fade-in w-full">
      <Link href="/pm" className="inline-flex items-center gap-2 text-sm text-[var(--ink-faint)] hover:text-[var(--ink)] mb-5 transition">
         Back to inbox
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left — lead info */}
        <div className="lg:col-span-2 space-y-5">
          {/* Header card */}
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] font-bold text-lg">
                  {lead.full_name.charAt(0)}
                </div>
                <div>
                  <h1 className="font-display text-xl font-semibold text-[var(--ink)]">{lead.full_name}</h1>
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
                  <item.icon size={15} className="text-[var(--ink-faint)] mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs text-[var(--ink-faint)]">{item.label}</div>
                    <div className="font-medium text-[var(--ink)] break-all">{item.value}</div>
                  </div>
                </div>
              ))}
            </div>

            {lead.phone && (
              <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--line-soft)]">
                <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-xl text-xs font-semibold hover:bg-green-700 transition">
                   Call
                </a>
                <a href={`https://wa.me/${lead.phone.replace(/^0/, '233')}`} target="_blank"
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#25D366] text-white rounded-xl text-xs font-semibold hover:opacity-90 transition">
                   WhatsApp
                </a>
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 px-3 py-2 bg-[var(--accent)] text-white rounded-xl text-xs font-semibold hover:brightness-110 transition">
                     Email
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Add note */}
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
            <h3 className="text-sm font-semibold text-[var(--ink)] mb-3">Add Note</h3>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Write a note..."
              className="w-full text-sm px-3 py-2 border border-[var(--line)] rounded-xl resize-none focus:outline-none focus:border-[var(--accent)] mb-2" />
            <button onClick={addNote} className="px-4 py-2 bg-[var(--accent)] text-white rounded-xl text-xs font-semibold hover:brightness-110 transition">
              Save Note
            </button>
          </div>

          {/* Activity timeline */}
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
            <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Activity Timeline</h3>
            {activities.length === 0 ? (
              <p className="text-sm text-[var(--ink-faint)] text-center py-4">No activities yet</p>
            ) : (
              <div className="space-y-3">
                {activities.map(a => (
                  <div key={a.id} className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-[var(--accent-soft)] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-[var(--accent)]">{a.activity_type.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-[var(--ink)]">{a.subject}</div>
                      {a.description && <div className="text-xs text-[var(--ink-faint)] mt-0.5">{a.description}</div>}
                      <div className="text-[10px] text-[var(--ink-faint)] mt-0.5">{formatDateTime(a.created_at)} · {(a as any).creator?.full_name || 'System'}</div>
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
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
            <h3 className="text-sm font-semibold text-[var(--ink)] mb-3">Assignment</h3>
            {assignee ? (
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xs font-bold">{assignee.full_name?.charAt(0)}</div>
                <div>
                  <div className="text-sm font-semibold text-[var(--ink)]">{assignee.full_name}</div>
                  <div className="text-xs text-[var(--ink-faint)]">{assignee.email}</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--ink-faint)] mb-3">Unassigned</p>
            )}
            <select onChange={e => reassign(e.target.value)} defaultValue=""
              className="w-full h-10 px-3 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none focus:border-[var(--accent)]">
              <option value="" disabled>{assignee ? 'Reassign to...' : 'Assign to...'}</option>
              {marketers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </div>

          {/* Status history */}
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
            <h3 className="text-sm font-semibold text-[var(--ink)] mb-3">Status History</h3>
            {logs.length === 0 ? <p className="text-xs text-[var(--ink-faint)]">No changes yet</p> : (
              <div className="space-y-2">
                {logs.map(l => (
                  <div key={l.id} className="text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[var(--ink-faint)] line-through">{l.old_status?.replace(/_/g,' ')}</span>
                      <span className="text-[var(--ink-faint)]">to</span>
                      <span className={`font-semibold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[l.new_status]}`}>{l.new_status.replace(/_/g,' ')}</span>
                    </div>
                    <div className="text-[var(--ink-faint)] mt-0.5">{formatDateTime(l.created_at)}</div>
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

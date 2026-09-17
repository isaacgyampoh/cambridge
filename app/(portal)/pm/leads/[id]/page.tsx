'use client'
import { useState, useEffect, use, useCallback } from 'react'
import { LoadingState, ErrorState, StatusBadge } from '@/components/ui'
import { apiQuery, ApiQueryError } from '@/lib/api/query'
import { mutate } from '@/hooks/useData'
import { formatDateTime, formatPhone, SOURCE_COLORS } from '@/lib/utils'
import type { Lead, LeadActivity, LeadStatusLog, Profile } from '@/types'
import { toast } from 'sonner'
import { Phone, MessageSquare, Mail, MapPin, BookOpen, Clock } from 'lucide-react'
import Link from 'next/link'
import { whatsappHref } from '@/lib/ui/contact'
import CallButton from '@/components/shared/CallButton'



export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [lead, setLead] = useState<Lead | null>(null)
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [logs, setLogs] = useState<LeadStatusLog[]>([])
  const [marketers, setMarketers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * useCallback so the effect's dependency on it is real rather than implied.
   * `id` is what it reads; listing that alone worked only because the function
   * is rebuilt every render.
   */
  const load = useCallback(async () => {
    /*
     * Wrapped, because apiQuery now throws rather than returning []. On a 401
     * or a 500 this page used to show "Lead not found" — which says the
     * record does not exist when what actually happened is that nobody asked
     * successfully. On a lead someone is mid-conversation with, that is the
     * wrong thing to be told.
     */
    try {
      const [leads, a, lg, m] = await Promise.all([
        apiQuery<Lead>('leads', '*, assignee:assigned_to(full_name,email,phone,role)', { filters: [{ col: 'id', op: 'eq', val: id }], limit: 1 }),
        apiQuery<LeadActivity>('lead_activities', '*, creator:created_by(full_name)', { filters: [{ col: 'lead_id', op: 'eq', val: id }], limit: 200 }),
        apiQuery<LeadStatusLog>('lead_status_logs', '*, changer:changed_by(full_name)', { filters: [{ col: 'lead_id', op: 'eq', val: id }], limit: 200 }),
        apiQuery<Profile>('profiles', '*', { filters: [{ col: 'role', op: 'eq', val: 'marketing_officer' }, { col: 'is_active', op: 'eq', val: true }], limit: 200 }),
      ])
      setLead(leads[0] || null); setActivities(a); setLogs(lg); setMarketers(m)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiQueryError ? e.userMessage : 'This lead could not be loaded. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(s => setUserId(s?.userId || null)).catch(() => {})
    load()
  }, [id, load])


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
      /*
       * ── WHY THERE IS NO PATCH HERE ANY MORE ──────────────────────────
       *
       * This used to write leads.assigned_to directly through /api/data and
       * THEN call /api/leads/assign. Doing both is what stopped every
       * notification.
       *
       * assign_lead_to ends with
       *
       *     IF v_current IS NOT DISTINCT FROM p_marketer THEN
       *       RETURN FALSE;   -- already theirs; nothing to record
       *
       * The PATCH had just made the lead theirs, so the RPC returned false,
       * the route answered 409, and everything after that early return never
       * ran: the SMS to the marketer, the WhatsApp to the lead, the audit
       * entry, the lead_activities row, and onLeadAssigned — which is what
       * increments the pending-SMS counter and writes the in-app
       * notification.
       *
       * The 409 was discarded, and the operator was told
       * "Lead assigned! Marketer notified via SMS & WhatsApp."
       *
       * Nobody was notified, ever, by either of these two screens.
       *
       * The PATCH also bypassed isEligible(), so a lead could be handed to
       * somebody with no leads portal — assigned correctly, and invisible to
       * them.
       *
       * The route does the whole job: eligibility, the locked write, the
       * history row, the notifications. Its answer is read.
       */
      const res = await fetch('/api/leads/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: id, marketerId }),
      })
      const d = await res.json().catch(() => null)

      if (!res.ok || !d?.success) {
        toast.error(d?.error || 'This lead could not be reassigned. Please try again.')
        load()
        return
      }

      toast.success('Reassigned. The marketer has been notified.')
      load()
    } catch {
      toast.error('We could not reach the server. Check your connection and try again.')
    }
  }

  if (loading) return <LoadingState />
  if (error) return <ErrorState title="This lead did not load" message={error} onRetry={load} />
  if (!lead) return <div className="text-center py-20 text-[var(--ink-faint)]">Lead not found</div>

  const assignee = (lead as any).assignee

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <Link href="/pm" className="inline-flex items-center gap-2 text-sm text-[var(--ink-faint)] hover:text-[var(--ink)] mb-5 transition">
         Back to inbox
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left — lead info */}
        <div className="lg:col-span-2 space-y-5">
          {/* Header card */}
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] font-bold text-lg">
                  {lead.full_name.charAt(0)}
                </div>
                <div>
                  <h1 className="font-display text-xl font-semibold text-[var(--ink)]">{lead.full_name}</h1>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[lead.source]}`}>{lead.source}</span>
                    <StatusBadge domain="lead" value={lead.status} size="sm" />
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
                <CallButton leadId={id as string} phone={lead.phone} onLogged={() => load()}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[var(--ok)] text-white rounded-xl text-xs font-semibold hover:opacity-90 transition disabled:opacity-60" />
                {whatsappHref(lead.phone) && (
                  <a href={whatsappHref(lead.phone) as string}
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                      border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--canvas)] transition">
                    <MessageSquare size={14} aria-hidden="true" /> WhatsApp
                  </a>
                )}
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 px-3 py-2 bg-[var(--accent)] text-white rounded-xl text-xs font-semibold hover:brightness-110 transition">
                     Email
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Add note */}
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
            <h3 className="text-sm font-semibold text-[var(--ink)] mb-3">Add Note</h3>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Write a note..."
              className="w-full text-sm px-3 py-2 border border-[var(--line)] rounded-xl resize-none focus:outline-none focus:border-[var(--accent)] mb-2" />
            <button onClick={addNote} className="px-4 py-2 bg-[var(--accent)] text-white rounded-xl text-xs font-semibold hover:brightness-110 transition">
              Save note
            </button>
          </div>

          {/* Activity timeline */}
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
            <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Activity Timeline</h3>
            {activities.length === 0 ? (
              <p className="text-sm text-[var(--ink-faint)] text-center py-4">No activities yet</p>
            ) : (
              <div className="space-y-3">
                {activities.map(a => (
                  <div key={a.id} className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-[var(--accent-soft)] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[11px] font-bold text-[var(--accent)]">{a.activity_type.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-[var(--ink)]">{a.subject}</div>
                      {a.description && <div className="text-xs text-[var(--ink-faint)] mt-0.5">{a.description}</div>}
                      <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">{formatDateTime(a.created_at)} · {(a as any).creator?.full_name || 'System'}</div>
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
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
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
              className="w-full h-10 px-3 rounded-2xl border border-[var(--line)] text-sm bg-[var(--paper)] focus:outline-none focus:border-[var(--accent)]">
              <option value="" disabled>{assignee ? 'Reassign to...' : 'Assign to...'}</option>
              {marketers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </div>

          {/* Status history */}
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
            <h3 className="text-sm font-semibold text-[var(--ink)] mb-3">Status History</h3>
            {logs.length === 0 ? <p className="text-xs text-[var(--ink-faint)]">No changes yet</p> : (
              <div className="space-y-2">
                {logs.map(l => (
                  <div key={l.id} className="text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[var(--ink-faint)] line-through">{l.old_status?.replace(/_/g,' ')}</span>
                      <span className="text-[var(--ink-faint)]">to</span>
                      <StatusBadge domain="lead" value={l.new_status} size="sm" />
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

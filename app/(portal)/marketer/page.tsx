'use client'
import { useState, useEffect } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { toast } from 'sonner'
import { STATUS_COLORS, formatGHS } from '@/lib/utils'
import { Phone, MessageSquare, ChevronDown, ChevronUp, Plus, Clock } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { changeLeadStatus } from '@/lib/leadStatus'

const STATUSES = [
  { key: 'contacted',     label: 'Contacted',      color: 'bg-[var(--accent-soft)] text-[var(--accent)]', needsComment: false },
  { key: 'qualified',     label: 'Qualified',      color: 'bg-teal-100 text-teal-700',      needsComment: true },
  { key: 'interested',    label: 'Interested',     color: 'bg-indigo-100 text-indigo-700',  needsComment: false, sendsLink: true },
  { key: 'follow_up',     label: 'Follow Up',      color: 'bg-orange-100 text-orange-700',  needsComment: true },
  { key: 'next_session',  label: 'Next Session',   color: 'bg-amber-100 text-amber-700',    needsComment: true },
  { key: 'not_interested',label: 'Not Interested', color: 'bg-red-100 text-red-600',        needsComment: true },
  { key: 'lost',          label: 'Lost',           color: 'bg-[var(--line-soft)] text-[var(--ink-soft)]', needsComment: true },
]

export default function MarketerDashboard() {
  const router = useRouter()
  const [remun, setRemun] = useState<any>(null)

  useEffect(() => {
    fetch('/api/remuneration?scope=me').then(r => r.ok ? r.json() : null).then(d => setRemun(d)).catch(() => {})
  }, [])
  const [myId, setMyId] = useState<string|null>(null)
  const [expanded, setExpanded] = useState<string|null>(null)
  const [updating, setUpdating] = useState<string|null>(null)
  const [pendingStatus, setPendingStatus] = useState<{ leadId: string; status: string } | null>(null)
  const [comment, setComment] = useState('')

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

  // Step 1: marketer taps a status button
  function pickStatus(leadId: string, newStatus: string) {
    // Registration must go through the register flow (programme + points).
    if (newStatus === 'registered') {
      router.push(`/marketer/leads/${leadId}`)
      return
    }
    const def = STATUSES.find(s => s.key === newStatus)
    // Statuses that need a comment open a comment box first
    if (def?.needsComment) {
      setPendingStatus({ leadId, status: newStatus })
      setComment('')
      return
    }
    // Otherwise apply immediately
    applyStatus(leadId, newStatus, '')
  }

  // Step 2: apply the status (with comment if one was required/given)
  async function applyStatus(leadId: string, newStatus: string, commentText: string) {
    const def = STATUSES.find(s => s.key === newStatus)
    if (def?.needsComment && !commentText.trim()) {
      toast.error('Please add a comment so the PM understands why')
      return
    }
    setUpdating(leadId)
    try {
      const result = await changeLeadStatus(leadId, newStatus)
      if (result.error) { toast.error(result.error); return }

      // Log the comment so PM/admin can see the reason
      if (commentText.trim() && myId) {
        await mutate('POST', 'lead_activities', {
          lead_id: leadId, activity_type: 'note',
          subject: `${def?.label || newStatus}`, description: commentText, created_by: myId,
        })
      }

      // Interested -> auto-send the registration link via WhatsApp
      if (def?.sendsLink) {
        const r = await fetch('/api/leads/send-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId }),
        }).then(r => r.json()).catch(() => null)
        if (r?.success) toast.success('Marked Interested — registration link sent on WhatsApp')
        else toast.success('Marked Interested — open the lead to send the link')
      } else if (newStatus === 'ready_to_join') {
        await fetch('/api/admissions', { method: 'POST', headers: { 'Content-Type': 'application/json'}, body: JSON.stringify({ leadId }) })
        toast.success('Moved to Ready to Join — Admissions notified')
      } else {
        toast.success(`Moved to ${def?.label || newStatus.replace(/_/g, ' ')}`)
      }

      setPendingStatus(null)
      setComment('')
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

  const convertedCount = leads.filter(l => ['ready_to_join', 'registered'].includes(l.status)).length
  const convRate = leads.length ? Math.round((convertedCount / leads.length) * 100) : 0

  const statusOrder = ['new','contacted','interested','follow_up','ready_to_join','not_interested','lost','registered']
  const COLORS: Record<string,string> = {
    new:'bg-yellow-100 text-yellow-800', contacted:'bg-[var(--accent-soft)] text-[var(--accent)]',
    interested:'bg-indigo-100 text-indigo-700', follow_up:'bg-orange-100 text-orange-700',
    ready_to_join:'bg-green-100 text-green-700', registered:'bg-emerald-100 text-emerald-700',
    not_interested:'bg-red-100 text-red-600', lost:'bg-[var(--line-soft)] text-[var(--ink-soft)]',
  }

  return (
    <div className="fade-in w-full">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-2">My work</div>
          <h1 className="font-display text-[28px] leading-tight font-semibold text-[var(--ink)]">My leads</h1>
          <p className="text-[var(--ink-soft)] text-sm mt-1.5">{leads.length} assigned to you</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Link href="/marketer/activities"
            className="inline-flex items-center gap-1.5 h-10 px-4 bg-[var(--accent-soft)] text-[var(--accent)] rounded-lg text-sm font-medium hover:brightness-95 transition">
            <Clock size={14} /> Follow-ups
          </Link>
          <Link href="/marketer/link"
            className="inline-flex items-center gap-1.5 h-10 px-4 bg-white border border-[var(--line)] text-[var(--ink-soft)] rounded-lg text-sm font-medium hover:border-[var(--ink-faint)] transition">
            My link
          </Link>
        </div>
      </div>

      {/* Rank & earnings summary */}
      {remun && (
        <Link href="/marketer/earnings" className="block mb-6 group">
          <div className="rounded-2xl bg-[var(--accent)] text-white p-5 sm:p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-white/5 -mr-14 -mt-14" />
            <div className="relative flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-white/55 mb-1">Your rank · {remun.year}</div>
                <div className="font-display text-[26px] leading-none font-semibold">{remun.currentRank?.name || 'Unranked'}</div>
                <div className="text-white/70 text-sm mt-1.5">{remun.totalPoints} points{remun.nextRank ? ` · ${remun.pointsToNext} to ${remun.nextRank.name}` : ''}</div>
              </div>
              <div className="flex gap-6">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.1em] text-white/55">Salary</div>
                  <div className="font-display text-xl font-semibold mt-1">{formatGHS(remun.grossSalary)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.1em] text-white/55">Registration</div>
                  <div className="font-display text-xl font-semibold mt-1">{formatGHS(remun.registrationCommission)}</div>
                </div>
                <div className="hidden sm:block">
                  <div className="text-[11px] uppercase tracking-[0.1em] text-white/55">Conversion</div>
                  <div className="font-display text-xl font-semibold mt-1">{convRate}%</div>
                </div>
              </div>
            </div>
            {remun.nextRank && (
              <div className="relative mt-4 h-1.5 bg-white/15 rounded-full overflow-hidden">
                <div className="h-full bg-white/80 rounded-full transition-all" style={{ width: `${remun.progressPct}%` }} />
              </div>
            )}
          </div>
        </Link>
      )}

      {/* Mini pipeline */}
      <div className="grid grid-cols-4 lg:grid-cols-7 gap-1.5 mb-5">
        {statusOrder.filter(s => byStatus[s]?.length > 0).map(s => (
          <div key={s} className={`rounded-xl p-2 text-center ${COLORS[s]}`}>
            <div className="text-lg font-black">{byStatus[s]?.length}</div>
            <div className="text-[9px] font-semibold capitalize leading-tight mt-0.5">{s.replace(/_/g, ' ')}</div>
          </div>
        ))}
      </div>

      {/* Lead list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : leads.length === 0 ? (
        <div className="bg-[var(--paper)] rounded-xl border border-dashed border-[var(--line)] p-16 text-center text-[var(--ink-faint)]">
          <p className="font-medium">No leads assigned yet</p>
          <p className="text-sm mt-1">The project manager will assign leads to you</p>
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map(lead => {
            const isExpanded = expanded === lead.id
            return (
              <div key={lead.id} className="bg-[var(--paper)] rounded-xl border border-[var(--line)] overflow-hidden hover:border-[var(--ink-faint)] transition-colors">
                {/* Header row */}
                <div className="flex items-center px-4 py-3 cursor-pointer"
                  onClick={() => setExpanded(isExpanded ? null : lead.id)}>
                  <div className="w-9 h-9 rounded-full bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] font-semibold text-sm flex-shrink-0 mr-3">
                    {lead.full_name?.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-[var(--ink)] truncate">{lead.full_name}</div>
                    <div className="text-[11px] text-[var(--ink-faint)]">{lead.phone} {lead.course_interest ? `· ${lead.course_interest}` : ''}</div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mx-2 flex-shrink-0 ${COLORS[lead.status]||'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
                    {lead.status?.replace(/_/g, ' ')}
                  </span>
                  {isExpanded ? <ChevronUp size={15} className="text-[var(--ink-faint)]"/> : <ChevronDown size={15} className="text-[var(--ink-faint)]" />}
                </div>

                {/* Expanded actions */}
                {isExpanded && (
                  <div className="border-t border-[var(--line-soft)] bg-[var(--canvas)] px-4 py-3">
                    {/* Quick contact */}
                    {lead.phone && (
                      <div className="flex gap-2 mb-3">
                        <a href={`tel:${lead.phone}`}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition">
                          <Phone size={12} /> Call
                        </a>
                        <a href={`https://wa.me/${String(lead.phone).replace(/^0/,'233').replace(/\D/,'')}?text=${encodeURIComponent(`Hello ${lead.full_name?.split(' ')[0]}, this is from Cambridge Centre of Excellence...`)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#25D366] text-white rounded-lg text-xs font-semibold hover:opacity-90 transition">
                          <MessageSquare size={12} /> WhatsApp
                        </a>
                        <Link href={`/marketer/leads/${lead.id}`}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[var(--line)] text-[var(--ink-soft)] rounded-lg text-xs font-semibold hover:bg-[var(--line-soft)] transition">
                          Full view
                        </Link>
                      </div>
                    )}

                    {/* Comment box appears when a comment-required status is pending */}
                    {pendingStatus && pendingStatus.leadId === lead.id ? (
                      (() => {
                        const ps = pendingStatus
                        return (
                      <div className="bg-white border border-[var(--accent)] rounded-lg p-3">
                        <div className="text-xs font-semibold text-[var(--ink)] mb-1.5">
                          {STATUSES.find(s => s.key === ps.status)?.label} — add a comment
                        </div>
                        <p className="text-[11px] text-[var(--ink-faint)] mb-2">Explain the reason so the PM and admin understand.</p>
                        <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} autoFocus
                          placeholder={
                            ps.status === 'not_interested' ? 'Why is the lead not interested?' :
                            ps.status === 'next_session' ? 'Which session will they join, and why the wait?' :
                            ps.status === 'follow_up' ? 'What needs following up, and when?' :
                            ps.status === 'qualified' ? 'Why is this lead qualified?' :
                            'Add your comment...'
                          }
                          className="w-full text-xs px-3 py-2 border border-[var(--line)] rounded-lg resize-none focus:outline-none focus:border-[var(--accent)] bg-white mb-2" />
                        <div className="flex gap-2">
                          <button disabled={updating === lead.id}
                            onClick={() => applyStatus(lead.id, ps.status, comment)}
                            className="flex-1 h-9 bg-[var(--accent)] text-white rounded-lg text-xs font-semibold hover:brightness-110 disabled:opacity-50 transition">
                            {updating === lead.id ? 'Saving…' : 'Save & update'}
                          </button>
                          <button onClick={() => { setPendingStatus(null); setComment('') }}
                            className="px-4 h-9 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--ink-soft)]">Cancel</button>
                        </div>
                      </div>
                        )
                      })()
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[10px] font-bold text-[var(--ink-faint)] uppercase self-center mr-1">Move to:</span>
                        {STATUSES.filter(s => s.key !== lead.status).map(s => (
                          <button key={s.key} disabled={updating === lead.id}
                            onClick={() => pickStatus(lead.id, s.key)}
                            className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-transparent transition hover:opacity-80 disabled:opacity-40 ${s.color}`}>
                            {s.label}
                          </button>
                        ))}
                        {/* Register shortcut */}
                        <button onClick={() => router.push(`/marketer/leads/${lead.id}`)}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[var(--accent)] text-white transition hover:brightness-110">
                          Register
                        </button>
                      </div>
                    )}
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

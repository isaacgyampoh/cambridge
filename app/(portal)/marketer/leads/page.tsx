'use client'
import { useState, useEffect } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { toast } from 'sonner'
import { STATUS_COLORS, formatGHS } from '@/lib/utils'
import { Phone, MessageSquare, ChevronDown, ChevronUp, Plus, Clock, ArrowLeftRight, X } from 'lucide-react'
import Link from 'next/link'
import CallButton from '@/components/shared/CallButton'
import { useRouter } from 'next/navigation'
import { changeLeadStatus } from '@/lib/leadStatus'

const STATUSES = [
  { key: 'contacted',     label: 'Contacted',      color: 'bg-[var(--accent-soft)] text-[var(--accent)]', needsComment: false },
  { key: 'interested',    label: 'Interested',     color: 'bg-[var(--info-soft)] text-[var(--info)]',  needsComment: false, sendsLink: true },
  { key: 'follow_up',     label: 'Follow Up',      color: 'bg-[var(--warn-soft)] text-[var(--warn)]',  needsComment: true },
  { key: 'next_session',  label: 'Next Session',   color: 'bg-[var(--warn-soft)] text-[var(--warn)]',    needsComment: true },
  { key: 'zuku',          label: 'Zuku',           color: 'bg-[var(--danger-soft)] text-[var(--danger)]',        needsComment: true, hint: 'Not qualified — give the reason' },
  { key: 'defiled',       label: 'Defiled',        color: 'bg-[var(--gold-soft)] text-[var(--gold)]',  needsComment: true, hint: 'Stopped current class to join the next — why?' },
  { key: 'conflicts',     label: 'Conflicts',      color: 'bg-[var(--danger-soft)] text-[var(--danger)]',      needsComment: true, hint: 'What is the conflict?' },
  { key: 'deferred',      label: 'Deferred',       color: 'bg-[var(--line-soft)] text-[var(--ink-soft)]',    needsComment: true, hint: 'Give the reason for deferring' },
  { key: 'done',          label: 'Done',           color: 'bg-emerald-100 text-[var(--ok)]', needsComment: false, hint: 'Completed the class' },
]

export default function MarketerLeads() {
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
  const [reqOpen, setReqOpen] = useState(false)
  const [reqPhone, setReqPhone] = useState('')
  const [reqReason, setReqReason] = useState('')
  const [reqFound, setReqFound] = useState<any>(null)
  const [reqBusy, setReqBusy] = useState(false)

  async function lookupLead() {
    if (!reqPhone.trim()) return
    setReqBusy(true); setReqFound(null)
    try {
      const d = await fetch('/api/leads/transfer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lookup', phone: reqPhone }),
      }).then(r => r.json())
      if (!d.found) { toast.error('No lead found with that number'); setReqBusy(false); return }
      if (d.lead.mine) { toast.error('This lead is already yours'); setReqBusy(false); return }
      setReqFound({ ...d.lead, assignee: { full_name: d.lead.owner_name } })
    } catch { toast.error('Lookup failed') }
    finally { setReqBusy(false) }
  }

  async function submitRequest() {
    if (!reqFound) return
    setReqBusy(true)
    try {
      const res = await fetch('/api/leads/transfer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', leadId: reqFound.id, reason: reqReason }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success('Transfer request sent to the manager')
      setReqOpen(false); setReqPhone(''); setReqReason(''); setReqFound(null)
    } catch (e: any) { toast.error(e.message) }
    finally { setReqBusy(false) }
  }

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

      // Set a follow-up reminder date for follow-up / next-session statuses
      if (newStatus === 'follow_up' || newStatus === 'next_session') {
        const days = newStatus === 'next_session' ? 7 : 2
        const due = new Date(); due.setDate(due.getDate() + days)
        await mutate('PATCH', 'leads', { next_follow_up: due.toISOString() }, [{ col: 'id', val: leadId }]).catch(() => {})
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

  // Follow-ups due today or overdue
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
  const dueFollowUps = leads.filter((l: any) =>
    l.next_follow_up && new Date(l.next_follow_up) <= todayEnd &&
    !['registered', 'lost', 'not_interested'].includes(l.status)
  ).sort((a: any, b: any) => new Date(a.next_follow_up).getTime() - new Date(b.next_follow_up).getTime())

  const convertedCount = leads.filter(l => ['ready_to_join', 'registered'].includes(l.status)).length
  const convRate = leads.length ? Math.round((convertedCount / leads.length) * 100) : 0

  const statusOrder = ['new','contacted','interested','follow_up','ready_to_join','not_interested','lost','registered']
  const COLORS: Record<string,string> = {
    new:'bg-[var(--warn-soft)] text-[var(--warn)]', contacted:'bg-[var(--accent-soft)] text-[var(--accent)]',
    interested:'bg-[var(--info-soft)] text-[var(--info)]', follow_up:'bg-[var(--warn-soft)] text-[var(--warn)]',
    ready_to_join:'bg-[var(--ok-soft)] text-[var(--ok)]', registered:'bg-emerald-100 text-[var(--ok)]',
    not_interested:'bg-[var(--danger-soft)] text-[var(--danger)]', lost:'bg-[var(--line-soft)] text-[var(--ink-soft)]',
  }

  return (
    <div className="fade-in w-full">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-[28px] leading-tight font-semibold text-[var(--ink)]">My leads</h1>
          <p className="text-[var(--ink-soft)] text-[15px] mt-1.5">{leads.length} assigned to you</p>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          <Link href="/marketer/leads/new"
            className="inline-flex items-center justify-center gap-1.5 h-10 px-4 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:brightness-110 transition">
             Add lead
          </Link>
          <Link href="/marketer/activities"
            className="inline-flex items-center justify-center gap-1.5 h-10 px-4 bg-[var(--accent-soft)] text-[var(--accent)] rounded-lg text-sm font-medium hover:brightness-95 transition">
             Follow-ups
          </Link>
          <Link href="/marketer/link"
            className="inline-flex items-center justify-center gap-1.5 h-10 px-4 bg-white border border-[var(--line)] text-[var(--ink-soft)] rounded-lg text-sm font-medium hover:border-[var(--ink-faint)] transition">
            My link
          </Link>
          <button onClick={() => setReqOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 h-10 px-4 bg-white border border-[var(--line)] text-[var(--ink-soft)] rounded-lg text-sm font-medium hover:border-[var(--ink-faint)] transition">
             Request a lead
          </button>
        </div>
      </div>

      {/* Rank & earnings summary */}
      {remun && (
        <Link href="/marketer/earnings" className="block mb-6 group">
          <div className="rounded-2xl bg-[var(--accent)] text-white p-5 sm:p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-white/5 -mr-14 -mt-14" />
            <div className="relative flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[12px] text-white/55 mb-1">Your rank · {remun.year}</div>
                <div className="font-display text-[26px] leading-none font-semibold">{remun.currentRank?.name || 'Unranked'}</div>
                <div className="text-white/70 text-sm mt-1.5">{remun.totalPoints} points{remun.nextRank ? ` · ${remun.pointsToNext} to ${remun.nextRank.name}` : ''}</div>
              </div>
              <div className="flex gap-6">
                <div>
                  <div className="text-[12px] text-white/55">Salary</div>
                  <div className="font-display text-xl font-semibold mt-1">{formatGHS(remun.grossSalary)}</div>
                </div>
                <div>
                  <div className="text-[12px] text-white/55">Registration</div>
                  <div className="font-display text-xl font-semibold mt-1">{formatGHS(remun.registrationCommission)}</div>
                </div>
                <div className="hidden sm:block">
                  <div className="text-[12px] text-white/55">Conversion</div>
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

      {/* Due follow-ups today */}
      {dueFollowUps.length > 0 && (
        <div className="mb-6 rounded-2xl border border-[var(--warn)]/20 bg-[var(--warn-soft)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-[var(--warn)]">{dueFollowUps.length} follow-up{dueFollowUps.length === 1 ? '' : 's'} due today</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {dueFollowUps.slice(0, 8).map((l: any) => (
              <Link key={l.id} href={`/marketer/leads/${l.id}`}
                className="inline-flex items-center gap-1.5 bg-white border border-[var(--warn)]/20 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:border-amber-300 transition">
                {l.full_name}
                {l.phone && <span className="text-[var(--ink-faint)]">· {String(l.phone).replace(/^233/, '0')}</span>}
              </Link>
            ))}
            {dueFollowUps.length > 8 && <span className="text-xs text-[var(--warn)] self-center">+{dueFollowUps.length - 8} more</span>}
          </div>
        </div>
      )}

      {/* Mini pipeline */}
      <div className="grid grid-cols-4 lg:grid-cols-7 gap-2 mb-6">
        {statusOrder.filter(s => byStatus[s]?.length > 0).map(s => (
          <div key={s} className={`rounded-xl px-3 py-3 text-center ${COLORS[s]}`}>
            <div className="text-[22px] font-semibold leading-none font-display">{byStatus[s]?.length}</div>
            <div className="text-[11px] font-medium capitalize leading-tight mt-1.5">{s.replace(/_/g, ' ')}</div>
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
              <div key={lead.id} className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] overflow-hidden hover:border-[var(--ink-faint)] transition-colors">
                {/* Header row */}
                <div className="flex items-center px-4 py-3.5 cursor-pointer"
                  onClick={() => setExpanded(isExpanded ? null : lead.id)}>
                  <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] font-semibold text-[15px] flex-shrink-0 mr-3">
                    {lead.full_name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[14px] text-[var(--ink)] truncate">{lead.full_name}</div>
                    <div className="text-[13px] text-[var(--ink-faint)] truncate">{lead.phone}{lead.course_interest ? ` · ${lead.course_interest}` : ''}</div>
                  </div>
                  <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ml-2 flex-shrink-0 ${COLORS[lead.status]||'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
                    {lead.status?.replace(/_/g, ' ')}
                  </span>
                </div>

                {/* Expanded actions */}
                {isExpanded && (
                  <div className="border-t border-[var(--line-soft)] bg-[var(--canvas)] px-4 py-3">
                    {/* Quick contact */}
                    {lead.phone && (
                      <div className="flex gap-2 mb-3">
                        <CallButton leadId={lead.id} phone={lead.phone} onLogged={() => refetch?.()}
                          className="inline-flex items-center gap-1.5 px-3.5 h-9 bg-[var(--accent)] text-white rounded-lg text-[13px] font-semibold hover:brightness-110 transition disabled:opacity-60" />
                        <a href={`https://wa.me/${String(lead.phone).replace(/^0/,'233').replace(/\D/,'')}?text=${encodeURIComponent(`Hello ${lead.full_name?.split(' ')[0]}, this is from Cambridge Centre of Excellence...`)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3.5 h-9 bg-[#25D366] text-white rounded-lg text-[13px] font-semibold hover:opacity-90 transition">
                          WhatsApp
                        </a>
                        <Link href={`/marketer/leads/${lead.id}`}
                          className="inline-flex items-center gap-1.5 px-3.5 h-9 bg-[var(--paper)] border border-[var(--line)] text-[var(--ink-soft)] rounded-lg text-[13px] font-semibold hover:bg-[var(--canvas)] transition">
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
                        <p className="text-[12px] text-[var(--ink-faint)] mb-2">Explain the reason so the PM and admin understand.</p>
                        <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} autoFocus
                          placeholder={
                            ps.status === 'zuku' ? 'Why is this lead not qualified? (Zuku)' :
                            ps.status === 'next_session' ? 'Which session will they join, and why the wait?' :
                            ps.status === 'follow_up' ? 'What needs following up, and when?' :
                            ps.status === 'defiled' ? 'Why did they stop the current class to join the next?' :
                            ps.status === 'conflicts' ? 'What is the conflict?' :
                            ps.status === 'deferred' ? 'Give the reason for deferring' :
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
                            className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-transparent transition hover:opacity-80 disabled:opacity-40 ${s.color}`}>
                            {s.label}
                          </button>
                        ))}
                        {/* Register shortcut */}
                        <button onClick={() => router.push(`/marketer/leads/${lead.id}`)}
                          className="text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-[var(--accent)] text-white transition hover:brightness-110">
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

      {/* Request a lead modal */}
      {reqOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setReqOpen(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl font-semibold text-[var(--ink)]">Request a lead</h2>
              <button onClick={() => setReqOpen(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"></button>
            </div>
            <p className="text-sm text-[var(--ink-soft)] mb-4">If a lead reached you but is assigned to someone else, enter their number to request the lead. Your manager will review it.</p>

            <label className="block text-[13px] font-medium text-[var(--ink-faint)] mb-1.5">Lead's phone number</label>
            <div className="flex gap-2 mb-4">
              <input value={reqPhone} onChange={e => setReqPhone(e.target.value)} placeholder="024 000 0000"
                className="flex-1 h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
              <button onClick={lookupLead} disabled={reqBusy}
                className="h-11 px-4 bg-[var(--accent-soft)] text-[var(--accent)] rounded-xl text-sm font-medium disabled:opacity-50">Find</button>
            </div>

            {reqFound && (
              <div className="rounded-xl bg-[var(--canvas)] p-4 mb-4">
                <div className="font-semibold text-[var(--ink)]">{reqFound.full_name}</div>
                <div className="text-xs text-[var(--ink-soft)] mt-0.5">
                  {reqFound.assigned_to ? `Currently with ${reqFound.assignee?.full_name || 'another marketer'}` : 'Currently unassigned'}
                </div>
                <textarea value={reqReason} onChange={e => setReqReason(e.target.value)} rows={2}
                  placeholder="Why should this lead be transferred to you?"
                  className="w-full mt-3 px-3 py-2 rounded-lg border border-[var(--line)] text-sm resize-none focus:outline-none focus:border-[var(--accent)]" />
                <button onClick={submitRequest} disabled={reqBusy}
                  className="w-full mt-3 h-11 bg-[var(--accent)] text-white rounded-xl text-sm font-bold disabled:opacity-50">
                  {reqBusy ? 'Sending…' : 'Send request to manager'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

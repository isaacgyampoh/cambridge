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
  { key: 'contacted', label: 'Contacted', color: 'bg-blue-100 text-blue-700'},
  { key: 'interested', label: 'Interested', color: 'bg-indigo-100 text-indigo-700'},
  { key: 'follow_up', label: 'Follow Up', color: 'bg-orange-100 text-orange-700'},
  { key: 'ready_to_join', label: 'Ready to Join', color: 'bg-green-100 text-green-700'},
  { key: 'not_interested', label: 'Not Interested', color: 'bg-red-100 text-red-600'},
  { key: 'lost', label: 'Lost', color: 'bg-gray-100 text-gray-600'},
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
    // Registration must go through the register flow (programme + points).
    if (newStatus === 'registered') {
      toast.info('Open the lead to register and earn points')
      router.push(`/marketer/leads/${leadId}`)
      return
    }
    setUpdating(leadId)
    try {
      const result = await changeLeadStatus(leadId, newStatus)
      if (result.error) { toast.error(result.error); return }
      if (newStatus === 'ready_to_join') {
        await fetch('/api/admissions', { method: 'POST', headers: { 'Content-Type': 'application/json'}, body: JSON.stringify({ leadId }) })
        toast.success('Moved to Ready to Join — Admissions team notified!')
      } else {
        toast.success(`Status → ${newStatus.replace(/_/g, ' ')}`)
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

  const convertedCount = leads.filter(l => ['ready_to_join', 'registered'].includes(l.status)).length
  const convRate = leads.length ? Math.round((convertedCount / leads.length) * 100) : 0

  const statusOrder = ['new','contacted','interested','follow_up','ready_to_join','not_interested','lost','registered']
  const COLORS: Record<string,string> = {
    new:'bg-yellow-100 text-yellow-800', contacted:'bg-blue-100 text-blue-700',
    interested:'bg-indigo-100 text-indigo-700', follow_up:'bg-orange-100 text-orange-700',
    ready_to_join:'bg-green-100 text-green-700', registered:'bg-emerald-100 text-emerald-700',
    not_interested:'bg-red-100 text-red-600', lost:'bg-gray-100 text-gray-600',
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
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mx-2 flex-shrink-0 ${COLORS[lead.status]||'bg-gray-100 text-gray-600'}`}>
                    {lead.status?.replace(/_/g, ' ')}
                  </span>
                  {isExpanded ? <ChevronUp size={15} className="text-gray-400"/> : <ChevronDown size={15} className="text-gray-400" />}
                </div>

                {/* Expanded actions */}
                {isExpanded && (
                  <div className="border-t border-[var(--line-soft)] bg-[var(--canvas)] px-4 py-3">
                    {/* Quick contact */}
                    {lead.phone && (
                      <div className="flex gap-2 mb-3">
                        <a href={`tel:${lead.phone}`}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-xl text-xs font-semibold hover:bg-green-700 transition">
                          <Phone size={12} /> Call
                        </a>
                        <a href={`https://wa.me/${String(lead.phone).replace(/^0/,'233').replace(/\D/,'')}?text=${encodeURIComponent(`Hello ${lead.full_name?.split(' ')[0]}, this is from Cambridge Centre of Excellence...`)}`}
                          target="_blank"rel="noopener noreferrer"
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

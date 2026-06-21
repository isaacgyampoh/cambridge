'use client'
import { useState, useEffect } from 'react'
import { mutate } from '@/hooks/useData'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'
import { Clock, CheckCircle, Phone, MessageSquare, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

export default function ActivitiesPage() {
  const [queue, setQueue] = useState<any[]>([])
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('today')

  useEffect(() => {
    async function init() {
      const s = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null)
      if (!s?.valid) return
      setProfile({ id: s.userId })
      loadQueue(s.userId)
    }
    init()
  }, [filter])

  async function loadQueue(userId: string) {
    setLoading(true)
    const now = new Date()
    const today = new Date(now.setHours(23, 59, 59))
    const tomorrow = new Date(Date.now() + 86400000)

    const filters: { col: string; op: string; val: any }[] = [
      { col: 'marketer_id', op: 'eq', val: userId },
      { col: 'status', op: 'eq', val: 'pending'},
    ]
    if (filter === 'today') filters.push({ col: 'follow_up_at', op: 'lte', val: today.toISOString() })
    else if (filter === 'overdue') filters.push({ col: 'follow_up_at', op: 'lte', val: now.toISOString() })
    else if (filter === 'tomorrow') {
      filters.push({ col: 'follow_up_at', op: 'gte', val: now.toISOString() })
      filters.push({ col: 'follow_up_at', op: 'lte', val: tomorrow.toISOString() })
    }

    const params = new URLSearchParams({
      table: 'follow_up_queue',
      select: '*, lead:lead_id(id, full_name, phone, status, course_interest)',
      filters: JSON.stringify(filters),
      orderBy: 'follow_up_at', limit: '50',
    })
    const res = await fetch(`/api/data?${params}`)
    const json = await res.json()
    setQueue(json.data || [])
    setLoading(false)
  }

  async function markDone(id: string) {
    try {
      await mutate('PATCH', 'follow_up_queue', { status: 'done', done_at: new Date().toISOString() }, [{ col: 'id', val: id }])
      toast.success('Marked as done!')
      if (profile) loadQueue(profile.id)
    } catch (e: any) {
      toast.error(e.message || 'Failed to update')
    }
  }

  async function snooze(id: string, hours: number) {
    try {
      const newTime = new Date(Date.now() + hours * 3600000).toISOString()
      await mutate('PATCH', 'follow_up_queue', { follow_up_at: newTime, status: 'snoozed'}, [{ col: 'id', val: id }])
      toast.success(`Snoozed for ${hours} hour${hours > 1 ? 's': ''}`)
      if (profile) loadQueue(profile.id)
    } catch (e: any) {
      toast.error(e.message || 'Failed to snooze')
    }
  }

  const overdue = queue.filter(q => new Date(q.follow_up_at) < new Date())

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Follow-up Queue</h1>
          <p className="text-[var(--ink-faint)] text-sm mt-0.5">{queue.length} tasks · {overdue.length} overdue</p>
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="bg-[var(--danger-soft)] border border-[var(--danger)]/20 rounded-2xl p-4 mb-5 flex items-center gap-3">
          <AlertTriangle size={20} className="text-[var(--danger)] flex-shrink-0" />
          <div>
            <div className="text-sm font-bold text-red-700">{overdue.length} overdue follow-up{overdue.length > 1 ? 's': ''}!</div>
            <div className="text-xs text-[var(--danger)]">These should have been done already. Take action now.</div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {[
          { key: 'today', label: 'Due Today'},
          { key: 'overdue', label: 'Overdue'},
          { key: 'all', label: 'All Pending'},
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${filter === f.key ? 'bg-[var(--accent)] text-white': 'bg-white text-[var(--ink-soft)] border border-[var(--line)]'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
      ) : queue.length === 0 ? (
        <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-16 text-center text-[var(--ink-faint)]">
          <CheckCircle size={40} className="mx-auto mb-3 opacity-30 text-green-500" />
          <p className="font-medium">All caught up! </p>
          <p className="text-sm mt-1">No follow-ups due. Keep up the great work!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {queue.map(item => {
            const lead = item.lead
            const isOverdue = new Date(item.follow_up_at) < new Date()
            return (
              <div key={item.id} className={`bg-[var(--paper)] rounded-xl border-2 p-4 ${isOverdue ? 'border-[var(--danger)]/20': 'border-[var(--line)]'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link href={`/marketer/leads/${lead?.id}`}
                        className="font-semibold text-[var(--ink)] hover:text-[var(--accent)] transition">
                        {lead?.full_name}
                      </Link>
                      {isOverdue && <span className="text-[10px] font-bold bg-[var(--danger-soft)] text-[var(--danger)] px-2 py-0.5 rounded-full">OVERDUE</span>}
                    </div>
                    {lead?.course_interest && <div className="text-xs text-[var(--accent)] mb-1"> {lead.course_interest}</div>}
                    {item.reason && <div className="text-xs text-[var(--ink-faint)] mb-2 line-clamp-2">{item.reason}</div>}
                    <div className="flex items-center gap-1 text-xs text-[var(--ink-faint)]">
                      <Clock size={11} />
                      <span className={isOverdue ? 'text-[var(--danger)] font-semibold': ''}>{formatDateTime(item.follow_up_at)}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {lead?.phone && (
                      <div className="flex gap-1">
                        <a href={`tel:${lead.phone}`}
                          className="w-9 h-9 rounded-xl bg-[var(--ok-soft)] flex items-center justify-center hover:bg-green-200 transition">
                          <Phone size={14} className="text-[var(--ok)]" />
                        </a>
                        <a href={`https://wa.me/${lead.phone.replace(/^0/, '233')}`} target="_blank"
                          className="w-9 h-9 rounded-xl bg-[#25D366]/10 flex items-center justify-center hover:bg-[#25D366]/20 transition">
                          <MessageSquare size={14} className="text-[#25D366]" />
                        </a>
                      </div>
                    )}
                    <button onClick={() => markDone(item.id)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-[var(--accent)] text-white rounded-xl text-xs font-semibold hover:brightness-110 transition">
                      <CheckCircle size={12} /> Done
                    </button>
                    <div className="flex gap-1">
                      {[1, 4, 24].map(h => (
                        <button key={h} onClick={() => snooze(item.id, h)}
                          className="flex-1 px-1.5 py-1 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-lg text-[10px] font-semibold hover:bg-[var(--line)] transition">
                          +{h}h
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

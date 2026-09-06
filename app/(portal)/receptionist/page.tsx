'use client'
import { useState } from 'react'
import { readableStatus } from '@/lib/ui/status'
import { useData } from '@/hooks/useData'
import { toast } from 'sonner'
import { RefreshCw, Send } from 'lucide-react'
import { formatDate, daysUntil } from '@/lib/utils'
import { Card, EmptyState } from '@/components/ui'

export default function ReceptionistDashboard() {
  const [sending, setSending] = useState<string|null>(null)
  const { data: batches, loading, refetch } = useData({
    table: 'batches',
    select: '*, courses(*), profiles!trainer_id(full_name)',
    filters: [{ col: 'status', op: 'in', val: ['upcoming','ongoing'] }],
    orderBy: 'start_date', orderAsc: true,
  })

  async function sendReminders(batchId: string, type: string) {
    setSending(batchId + type)
    const res = await fetch('/api/reminders/personalized', {
      method: 'POST', headers: { 'Content-Type': 'application/json'},
      body: JSON.stringify({ batchId, type }),
    })
    const d = await res.json()
    if (d.success) toast.success(` Personalized reminders sent to ${d.count} students — in their marketer's name!`)
    else toast.error('Failed to send reminders')
    setSending(null)
  }

  /*
   * Four ways to send the same reminder, so they look like four of the same
   * thing.
   *
   * They were accent, orange, purple and red — four unrelated hues for four
   * options of one kind, which reads as four unrelated actions and leaves the
   * operator deciding what the colours mean. Urgency is already carried by the
   * order and the words. Only the last one, sent on the morning of the class,
   * is emphasised, because it is the one that cannot be sent late.
   */
  const REMINDER_TYPES = [
    { type: '1_week',    label: 'A week before', urgent: false },
    { type: '2_days',    label: 'Two days before', urgent: false },
    { type: 'day',       label: 'The day before', urgent: false },
    { type: 'class_day', label: 'On the day', urgent: true },
  ]

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[13px] font-medium text-[var(--ink-faint)] mb-2">Front desk</div>
          <h1 className="font-display text-[24px] leading-tight font-semibold text-[var(--ink)]">Class reminders</h1>
          <p className="text-[var(--ink-soft)] text-sm mt-1.5">Send personalised reminders in each marketer’s name.</p>
        </div>
        <button type="button" onClick={refetch} aria-label="Refresh the list"
          className="h-10 w-10 flex items-center justify-center bg-[var(--paper)] border border-[var(--line)]
            text-[var(--ink-soft)] rounded-lg hover:border-[var(--ink-faint)] transition">
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="bg-[var(--accent-soft)] border border-[var(--accent-line)] rounded-2xl p-4 mb-5 text-sm text-[var(--accent)]">
         Messages go out as: <strong>”Hi Kofi, it’s Ama from Cambridge CE — your class is on Friday...”</strong>
        Each student gets their own assigned marketer’s name. Feels personal, not automated.
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" /></div>
      ) : batches.length === 0 ? (
        <Card>
          <EmptyState
            title="No classes scheduled"
            description="Upcoming and ongoing classes appear here once a batch is running."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {batches.map(batch => {
            const course = (batch as any).courses
            const trainer = (batch as any).profiles
            const days = batch.start_date ? daysUntil(batch.start_date) : null
            return (
              <div key={batch.id} className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-5 shadow-[var(--shadow-raised)]">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-[var(--ink)]">{batch.name}</h3>
                    <p className="text-sm text-[var(--ink-faint)]">{course?.name}</p>
                    <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-[var(--ink-faint)]">
                      {batch.start_date && <span> {formatDate(batch.start_date)}</span>}
                      {batch.schedule && <span> {batch.schedule}</span>}
                      {trainer && <span> {trainer.full_name}</span>}
                      {batch.venue && <span> {batch.venue}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${batch.status==='ongoing'?'bg-[var(--ok-soft)] text-[var(--ok)]':'bg-[var(--accent-soft)] text-[var(--accent)]'}`}>
                      {readableStatus(batch.status)}
                    </span>
                    {days !== null && days >= 0 && (
                      <div className={`text-xs font-semibold mt-1 ${days<=1?'text-[var(--danger)]':days<=7?'text-[var(--warn)]':'text-[var(--ink-faint)]'}`}>
                        {days === 0 ? 'Today!': `${days}d away`}
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-[var(--line-soft)] pt-4">
                  <p className="t-overline mb-2.5">Send a reminder by WhatsApp and SMS</p>
                  <div className="flex flex-wrap gap-2">
                    {REMINDER_TYPES.map(r => (
                      <button key={r.type} type="button"
                        disabled={!!sending}
                        onClick={() => sendReminders(batch.id, r.type)}
                        className={`inline-flex items-center gap-1.5 h-11 sm:h-10 px-4 rounded-xl
                          text-[13px] font-semibold transition-colors disabled:opacity-50
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
                          ${r.urgent
                            ? 'bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]'
                            : 'bg-[var(--paper)] text-[var(--ink)] border border-[var(--line)] hover:bg-[var(--canvas)]'}`}>
                        <Send size={14} aria-hidden="true" />
                        {sending === batch.id + r.type ? 'Sending…' : r.label}
                      </button>
                    ))}
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

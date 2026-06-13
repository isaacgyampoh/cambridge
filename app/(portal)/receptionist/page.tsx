'use client'
import { useState } from 'react'
import { useData } from '@/hooks/useData'
import { toast } from 'sonner'
import { Calendar, Send, RefreshCw } from 'lucide-react'
import { formatDate, daysUntil } from '@/lib/utils'

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

  const REMINDER_TYPES = [
    { type: '1_week', label: '1 Week Before', color: 'bg-blue-600 hover:bg-blue-700'},
    { type: '2_days', label: '2 Days Before', color: 'bg-orange-500 hover:bg-orange-600'},
    { type: 'day', label: 'Day Before', color: 'bg-purple-600 hover:bg-purple-700'},
    { type: 'class_day', label: 'Class Day ', color: 'bg-red-500 hover:bg-red-600'},
  ]

  return (
    <div className="fade-in w-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Class Reminders</h1>
          <p className="text-gray-400 text-sm">Send personalized reminders in each marketer's name</p>
        </div>
        <button onClick={refetch} className="h-9 w-9 flex items-center justify-center bg-white border border-gray-200 text-gray-500 rounded-xl hover:bg-gray-50 transition">
          <RefreshCw size={14} className={loading ? 'animate-spin': ''} />
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-5 text-sm text-blue-700">
         Messages go out as: <strong>"Hi Kofi, it's Ama from Cambridge CE — your class is on Friday..."</strong>
        Each student gets their own assigned marketer's name. Feels personal, not automated.
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : batches.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center text-gray-300">
          <Calendar size={36} className="mx-auto mb-3 opacity-50" />
          <p>No upcoming or ongoing classes</p>
        </div>
      ) : (
        <div className="space-y-4">
          {batches.map(batch => {
            const course = (batch as any).courses
            const trainer = (batch as any).profiles
            const days = batch.start_date ? daysUntil(batch.start_date) : null
            return (
              <div key={batch.id} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-gray-900">{batch.name}</h3>
                    <p className="text-sm text-gray-500">{course?.name}</p>
                    <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-400">
                      {batch.start_date && <span> {formatDate(batch.start_date)}</span>}
                      {batch.schedule && <span> {batch.schedule}</span>}
                      {trainer && <span> {trainer.full_name}</span>}
                      {batch.venue && <span> {batch.venue}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${batch.status==='ongoing'?'bg-green-100 text-green-700':'bg-blue-100 text-blue-700'}`}>
                      {batch.status}
                    </span>
                    {days !== null && days >= 0 && (
                      <div className={`text-xs font-semibold mt-1 ${days<=1?'text-red-500':days<=7?'text-orange-500':'text-gray-400'}`}>
                        {days === 0 ? 'Today!': `${days}d away`}
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-gray-50 pt-4">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Send Reminders via WhatsApp + SMS</p>
                  <div className="flex flex-wrap gap-2">
                    {REMINDER_TYPES.map(r => (
                      <button key={r.type}
                        disabled={!!sending}
                        onClick={() => sendReminders(batch.id, r.type)}
                        className={`flex items-center gap-1.5 px-4 py-2 ${r.color} text-white rounded-xl text-xs font-semibold disabled:opacity-50 transition`}>
                        <Send size={12} />
                        {sending === batch.id + r.type ? 'Sending...': r.label}
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

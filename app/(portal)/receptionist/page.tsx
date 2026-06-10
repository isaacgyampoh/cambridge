'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Batch } from '@/types'
import { toast } from 'sonner'
import { Bell, Calendar, Users, RefreshCw, Send } from 'lucide-react'
import { formatDate, daysUntil } from '@/lib/utils'

export default function ReceptionistDashboard() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)
  const sb = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await sb.from('batches')
      .select('*, courses(*), profiles!trainer_id(*)')
      .in('status', ['upcoming', 'ongoing'])
      .order('start_date')
    setBatches(data || [])
    setLoading(false)
  }

  async function sendReminders(batchId: string, type: string) {
    setSending(batchId)
    const res = await fetch('/api/reminders/personalized', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId, type }),
    })
    const d = await res.json()
    if (d.success) toast.success(`✅ Personalized reminders sent to ${d.count} of ${d.total} students — in each marketer's name!`)
    else toast.error('Failed to send reminders')
    setSending(null)
  }

  const upcoming = batches.filter(b => b.start_date && daysUntil(b.start_date) >= 0)

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reminders & Classes</h1>
          <p className="text-gray-500 text-sm mt-0.5">Send automated reminders to students</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600">
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{batches.length}</div>
          <div className="text-sm text-gray-500 mt-1">Active Batches</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4 text-center">
          <div className="text-3xl font-bold text-green-600">{upcoming.filter(b => b.start_date && daysUntil(b.start_date) <= 7).length}</div>
          <div className="text-sm text-gray-500 mt-1">Starting This Week</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4 text-center">
          <div className="text-3xl font-bold text-purple-600">{batches.filter(b => b.status === 'ongoing').length}</div>
          <div className="text-sm text-gray-500 mt-1">Ongoing Classes</div>
        </div>
      </div>

      {/* Batch cards */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
      ) : batches.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
          <Calendar size={40} className="mx-auto mb-3 opacity-30" />
          <p>No upcoming or ongoing classes</p>
        </div>
      ) : (
        <div className="space-y-4">
          {batches.map(batch => {
            const days = batch.start_date ? daysUntil(batch.start_date) : null
            const course = (batch as any).courses
            const trainer = (batch as any).profiles
            return (
              <div key={batch.id} className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-gray-900">{batch.name}</h3>
                    <p className="text-sm text-gray-500">{course?.name}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><Calendar size={12} /> {formatDate(batch.start_date)}</span>
                      {batch.schedule && <span>{batch.schedule}</span>}
                      {trainer && <span className="flex items-center gap-1"><Users size={12} /> {trainer.full_name}</span>}
                    </div>
                    {batch.venue && <p className="text-xs text-gray-400 mt-1">📍 {batch.venue}</p>}
                    {batch.zoom_link && <p className="text-xs text-blue-500 mt-1">🔗 Online class</p>}
                  </div>
                  <div>
                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${batch.status === 'ongoing' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                      {batch.status}
                    </span>
                    {days !== null && days >= 0 && (
                      <div className={`text-xs font-semibold mt-1 text-right ${days <= 1 ? 'text-red-500' : days <= 7 ? 'text-orange-500' : 'text-gray-400'}`}>
                        {days === 0 ? 'Today!' : `${days}d away`}
                      </div>
                    )}
                  </div>
                </div>

                {/* Reminder buttons */}
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Send Reminders</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { type: '1_week', label: '1 Week Before', color: 'bg-blue-600 hover:bg-blue-700' },
                      { type: '2_days', label: '2 Days Before', color: 'bg-orange-500 hover:bg-orange-600' },
                      { type: 'day', label: 'Day Before', color: 'bg-purple-600 hover:bg-purple-700' },
                      { type: 'class_day', label: 'Class Day 🔔', color: 'bg-red-500 hover:bg-red-600' },
                    ].map(r => (
                      <button key={r.type}
                        disabled={sending === batch.id}
                        onClick={() => sendReminders(batch.id, r.type)}
                        className={`flex items-center gap-1.5 px-4 py-2 ${r.color} text-white rounded-xl text-xs font-semibold disabled:opacity-50 transition`}>
                        <Send size={13} />
                        {sending === batch.id ? 'Sending...' : r.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-blue-500 mt-2 font-medium">💬 Sent in each student's assigned marketer's name — feels personal, not automated</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

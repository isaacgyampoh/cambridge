'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Admission } from '@/types'
import { toast } from 'sonner'
import { UserCheck, Clock, CheckCircle, FileText, RefreshCw } from 'lucide-react'

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  awaiting_forms: { label: 'Awaiting Forms', color: 'bg-blue-100 text-blue-700', icon: FileText },
  awaiting_payment: { label: 'Awaiting Payment', color: 'bg-orange-100 text-orange-700', icon: Clock },
  admitted: { label: 'Admitted', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-600', icon: Clock },
}

export default function AdmissionDashboard() {
  const [admissions, setAdmissions] = useState<Admission[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const sb = createClient()

  useEffect(() => {
    load()
    const ch = sb.channel('admissions-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admissions' }, load)
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [])

  async function load() {
    setLoading(true)
    const { data } = await sb.from('admissions')
      .select('*, lead:lead_id(*), course:course_id(*), batch:batch_id(*)')
      .order('created_at', { ascending: false })
    setAdmissions(data || [])
    setLoading(false)
  }

  async function updateStatus(admissionId: string, newStatus: string) {
    const { error } = await sb.from('admissions').update({
      status: newStatus,
      ...(newStatus === 'admitted' ? { offer_letter_sent_at: new Date().toISOString() } : {}),
    }).eq('id', admissionId)

    if (error) { toast.error('Failed to update'); return }
    toast.success('Admission updated')
    load()
  }

  const stats = {
    total: admissions.length,
    pending: admissions.filter(a => a.status === 'pending').length,
    awaiting: admissions.filter(a => ['awaiting_forms','awaiting_payment'].includes(a.status)).length,
    admitted: admissions.filter(a => a.status === 'admitted').length,
  }

  const filtered = filter === 'all' ? admissions : admissions.filter(a => a.status === filter)

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admissions</h1>
          <p className="text-gray-500 text-sm mt-0.5">Process and manage student admissions</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total', value: stats.total, color: 'bg-blue-50 text-blue-600' },
          { label: 'Pending', value: stats.pending, color: 'bg-yellow-50 text-yellow-600' },
          { label: 'In Progress', value: stats.awaiting, color: 'bg-orange-50 text-orange-600' },
          { label: 'Admitted', value: stats.admitted, color: 'bg-green-50 text-green-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-200 text-center">
            <div className={`text-3xl font-bold ${s.color.split(' ')[1]}`}>{s.value}</div>
            <div className="text-sm text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {[
          { key: 'all', label: 'All' },
          { key: 'pending', label: 'Pending' },
          { key: 'awaiting_forms', label: 'Awaiting Forms' },
          { key: 'awaiting_payment', label: 'Awaiting Payment' },
          { key: 'admitted', label: 'Admitted' },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition ${
              filter === f.key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Cards */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(a => {
            const sc = STATUS_CONFIG[a.status] || STATUS_CONFIG.pending
            const lead = (a as any).lead
            return (
              <div key={a.id} className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-gray-900">{lead?.full_name || '—'}</span>
                      <span className="text-xs text-gray-400 font-mono">{a.admission_number}</span>
                    </div>
                    <div className="text-sm text-gray-500">
                      {lead?.phone} · {lead?.email}
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">
                      Course: {(a as any).course?.name || lead?.course_interest || '—'}
                    </div>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${sc.color}`}>
                    {sc.label}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                  {a.status === 'pending' && (
                    <>
                      <button onClick={() => updateStatus(a.id, 'awaiting_forms')}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition">
                        Request Forms
                      </button>
                      <button onClick={() => updateStatus(a.id, 'awaiting_payment')}
                        className="px-3 py-1.5 bg-orange-500 text-white rounded-xl text-xs font-semibold hover:bg-orange-600 transition">
                        Awaiting Payment
                      </button>
                    </>
                  )}
                  {['awaiting_forms', 'awaiting_payment'].includes(a.status) && (
                    <button onClick={() => updateStatus(a.id, 'admitted')}
                      className="px-3 py-1.5 bg-green-600 text-white rounded-xl text-xs font-semibold hover:bg-green-700 transition">
                      ✓ Admit Student
                    </button>
                  )}
                  <button onClick={() => updateStatus(a.id, 'rejected')}
                    className="px-3 py-1.5 bg-red-50 text-red-600 rounded-xl text-xs font-semibold hover:bg-red-100 transition">
                    Reject
                  </button>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
              <UserCheck size={40} className="mx-auto mb-3 opacity-30" />
              <p>No admissions in this category</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

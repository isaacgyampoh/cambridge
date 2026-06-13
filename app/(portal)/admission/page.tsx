'use client'
import { useState } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { toast } from 'sonner'
import { UserCheck, RefreshCw, MessageSquare } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

const S: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800'},
  awaiting_forms: { label: 'Awaiting Forms', color: 'bg-blue-100 text-blue-700'},
  awaiting_payment: { label: 'Awaiting Payment', color: 'bg-orange-100 text-orange-700'},
  admitted: { label: 'Admitted ', color: 'bg-green-100 text-green-700'},
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-600'},
}

export default function AdmissionPage() {
  const [filter, setFilter] = useState('all')
  const [tab, setTab] = useState<'admissions'|'applications'>('admissions')
  const [acting, setActing] = useState<string|null>(null)

  const { data: admissions, loading: loadA, refetch: refetchA } = useData({
    table: 'admissions',
    select: '*, lead:lead_id(full_name,phone,email,course_interest), course:course_id(name)',
    orderBy: 'created_at',
  })

  const { data: applications, loading: loadApp, refetch: refetchApp } = useData({
    table: 'applications',
    select: '*, course:course_id(name), marketer:marketer_id(full_name)',
    orderBy: 'created_at', limit: 100,
  })

  const loading = loadA || loadApp

  async function updateStatus(id: string, status: string) {
    setActing(id)
    try {
      await mutate('PATCH', 'admissions',
        { status, ...(status==='admitted'? {offer_letter_sent_at: new Date().toISOString()} : {}) },
        [{ col: 'id', val: id }]
      )
      toast.success(`Updated to: ${S[status]?.label || status}`)
      refetchA()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setActing(null)
    }
  }

  const filtered = filter === 'all'? admissions : admissions.filter(a => a.status === filter)

  const stats = {
    total: admissions.length,
    pending: admissions.filter(a => a.status === 'pending').length,
    awaitingPayment: admissions.filter(a => a.status === 'awaiting_payment').length,
    admitted: admissions.filter(a => a.status === 'admitted').length,
  }

  return (
    <div className="fade-in w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admissions</h1>
          <p className="text-gray-400 text-sm">Process and track student admissions</p>
        </div>
        <button onClick={() => { refetchA(); refetchApp() }}
          className="h-9 w-9 flex items-center justify-center bg-white border border-gray-200 text-gray-500 rounded-xl hover:bg-gray-50 transition">
          <RefreshCw size={14} className={loading ? 'animate-spin': ''} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total', value: stats.total, color: 'text-blue-600 bg-blue-50'},
          { label: 'Pending', value: stats.pending, color: 'text-yellow-600 bg-yellow-50'},
          { label: 'Awaiting Payment', value: stats.awaitingPayment, color: 'text-orange-600 bg-orange-50'},
          { label: 'Admitted', value: stats.admitted, color: 'text-green-600 bg-green-50'},
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 text-center">
            <div className={`text-2xl font-bold ${s.color.split('')[0]}`}>{s.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4">
        {[{k:'admissions',l:`Admissions (${admissions.length})`},{k:'applications',l:`Applications (${applications.length})`}].map(t => (
          <button key={t.k} onClick={() => setTab(t.k as any)}
            className={`px-4 h-9 rounded-xl text-sm font-semibold transition ${tab===t.k?'bg-gray-900 text-white':'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'}`}>
            {t.l}
          </button>
        ))}
      </div>

      {tab === 'admissions'&& (
        <>
          {/* Filter pills */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {['all','pending','awaiting_forms','awaiting_payment','admitted','rejected'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`h-8 px-3 rounded-xl text-xs font-semibold transition capitalize ${filter===f?'bg-gray-900 text-white':'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'}`}>
                {f.replace(/_/g,'')}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
              <UserCheck size={36} className="mx-auto mb-3 text-gray-200" />
              <p className="text-gray-400 text-sm font-medium">No admissions here</p>
              <p className="text-gray-300 text-xs mt-1">Admissions are created when leads are marked "Ready to Join"</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(a => {
                const lead = a.lead
                const sc = S[a.status] || S.pending
                const isActing = acting === a.id
                return (
                  <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-bold text-gray-900 text-sm">{lead?.full_name || 'Unknown'}</span>
                          {a.admission_number && (
                            <span className="text-[10px] font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{a.admission_number}</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">{lead?.phone} {lead?.email ? `· ${lead.email}` : ''}</div>
                        {(a.course?.name || lead?.course_interest) && (
                          <div className="text-xs text-blue-600 font-medium mt-0.5"> {a.course?.name || lead?.course_interest}</div>
                        )}
                        <div className="text-[10px] text-gray-400 mt-1">{formatDateTime(a.created_at)}</div>
                      </div>
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ml-3 flex-shrink-0 ${sc.color}`}>
                        {sc.label}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-50">
                      {a.status === 'pending'&& <>
                        <button disabled={isActing} onClick={() => updateStatus(a.id, 'awaiting_forms')}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
                          Request Forms
                        </button>
                        <button disabled={isActing} onClick={() => updateStatus(a.id, 'awaiting_payment')}
                          className="px-3 py-1.5 bg-orange-500 text-white rounded-xl text-xs font-semibold hover:bg-orange-600 disabled:opacity-50 transition">
                          Awaiting Payment
                        </button>
                      </>}
                      {['awaiting_forms','awaiting_payment'].includes(a.status) && (
                        <button disabled={isActing} onClick={() => updateStatus(a.id, 'admitted')}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-xl text-xs font-semibold hover:bg-green-700 disabled:opacity-50 transition">
                           Admit Student
                        </button>
                      )}
                      {!['rejected','admitted'].includes(a.status) && (
                        <button disabled={isActing} onClick={() => updateStatus(a.id, 'rejected')}
                          className="px-3 py-1.5 bg-red-50 text-red-600 rounded-xl text-xs font-semibold hover:bg-red-100 disabled:opacity-50 transition">
                          Reject
                        </button>
                      )}
                      {lead?.phone && (
                        <a href={`https://wa.me/${String(lead.phone).replace(/^0/,'233').replace(/[^0-9]/,'')}?text=${encodeURIComponent(`Hello ${lead.full_name}, regarding your admission at Cambridge Centre of Excellence...`)}`}
                          target="_blank"rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-[#25D366] text-white rounded-xl text-xs font-semibold hover:opacity-90 transition flex items-center gap-1">
                          <MessageSquare size={12} /> WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'applications'&& (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          {loadApp ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Name','Email','Phone','Course','Payment','Marketer','Date'].map(h => (
                      <th key={h} className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {applications.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-12 text-gray-300 text-sm">No applications yet</td></tr>
                  ) : applications.map(app => (
                    <tr key={app.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">{app.full_name}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{app.email}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{app.phone}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{app.course?.name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${app.payment_status==='paid'?'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-700'}`}>
                          {app.payment_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{app.marketer?.full_name || 'Direct'}</td>
                      <td className="px-4 py-3 text-[11px] text-gray-400">{new Date(app.created_at).toLocaleDateString('en-GH')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

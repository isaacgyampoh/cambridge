'use client'
import { useState } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { toast } from 'sonner'
import { UserCheck, RefreshCw, MessageSquare } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

const S: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-[var(--warn-soft)] text-[var(--warn)]'},
  awaiting_forms: { label: 'Awaiting Forms', color: 'bg-[var(--accent-soft)] text-[var(--accent)]'},
  awaiting_payment: { label: 'Awaiting Payment', color: 'bg-[var(--warn-soft)] text-[var(--warn)]'},
  admitted: { label: 'Admitted ', color: 'bg-[var(--ok-soft)] text-[var(--ok)]'},
  rejected: { label: 'Rejected', color: 'bg-[var(--danger-soft)] text-[var(--danger)]'},
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-2">Admissions</div>
          <h1 className="font-display text-[28px] leading-tight font-semibold text-[var(--ink)]">Admissions</h1>
          <p className="text-[var(--ink-soft)] text-sm mt-1.5">Process and track student admissions.</p>
        </div>
        <button onClick={() => { refetchA(); refetchApp() }}
          className="h-10 w-10 flex items-center justify-center bg-white border border-[var(--line)] text-[var(--ink-soft)] rounded-lg hover:border-[var(--ink-faint)] transition">
          <RefreshCw size={14} className={loading ? 'animate-spin': ''} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total', value: stats.total, tone: 'text-[var(--ink)]' },
          { label: 'Pending', value: stats.pending, tone: 'text-[var(--warn)]' },
          { label: 'Awaiting payment', value: stats.awaitingPayment, tone: 'text-orange-600' },
          { label: 'Admitted', value: stats.admitted, tone: 'text-[var(--ok)]' },
        ].map(s => (
          <div key={s.label} className="bg-[var(--paper)] rounded-xl p-5 border border-[var(--line)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]">{s.label}</div>
            <div className={`font-display text-[28px] font-semibold mt-2 leading-none ${s.tone}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-[var(--line-soft)] rounded-lg p-1 w-fit">
        {[{k:'admissions',l:`Admissions (${admissions.length})`},{k:'applications',l:`Applications (${applications.length})`}].map(t => (
          <button key={t.k} onClick={() => setTab(t.k as any)}
            className={`px-4 h-8 rounded-md text-[13px] font-medium transition ${tab===t.k?'bg-white text-[var(--ink)] shadow-sm':'text-[var(--ink-faint)] hover:text-[var(--ink)]'}`}>
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
                className={`h-8 px-3 rounded-xl text-xs font-semibold transition capitalize ${filter===f?'bg-gray-900 text-white':'bg-white text-[var(--ink-faint)] border border-[var(--line)] hover:bg-[var(--line-soft)]'}`}>
                {f.replace(/_/g, ' ')}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-16 text-center">
              <UserCheck size={36} className="mx-auto mb-3 text-gray-200" />
              <p className="text-[var(--ink-faint)] text-sm font-medium">No admissions here</p>
              <p className="text-[var(--ink-faint)] text-xs mt-1">Admissions are created when leads are marked "Ready to Join"</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(a => {
                const lead = a.lead
                const sc = S[a.status] || S.pending
                const isActing = acting === a.id
                return (
                  <div key={a.id} className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-semibold text-[var(--ink)] text-sm">{lead?.full_name || 'Unknown'}</span>
                          {a.admission_number && (
                            <span className="text-[10px] font-mono bg-[var(--line-soft)] text-[var(--ink-faint)] px-1.5 py-0.5 rounded">{a.admission_number}</span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--ink-faint)]">{lead?.phone} {lead?.email ? `· ${lead.email}` : ''}</div>
                        {(a.course?.name || lead?.course_interest) && (
                          <div className="text-xs text-[var(--accent)] font-medium mt-0.5"> {a.course?.name || lead?.course_interest}</div>
                        )}
                        <div className="text-[10px] text-[var(--ink-faint)] mt-1">{formatDateTime(a.created_at)}</div>
                      </div>
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ml-3 flex-shrink-0 ${sc.color}`}>
                        {sc.label}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-3 border-t border-[var(--line-soft)]">
                      {a.status === 'pending'&& <>
                        <button disabled={isActing} onClick={() => updateStatus(a.id, 'awaiting_forms')}
                          className="px-3 py-1.5 bg-[var(--accent)] text-white rounded-xl text-xs font-semibold hover:brightness-110 disabled:opacity-50 transition">
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
                          className="px-3 py-1.5 bg-[var(--danger-soft)] text-[var(--danger)] rounded-xl text-xs font-semibold hover:bg-[var(--danger-soft)] disabled:opacity-50 transition">
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
        <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] overflow-hidden shadow-sm">
          {loadApp ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--line-soft)] border-b border-[var(--line-soft)]">
                  <tr>
                    {['Name','Email','Phone','Course','Payment','Marketer','Date'].map(h => (
                      <th key={h} className="text-left text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-wide px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {applications.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-12 text-[var(--ink-faint)] text-sm">No applications yet</td></tr>
                  ) : applications.map(app => (
                    <tr key={app.id} className="border-t border-[var(--line-soft)] hover:bg-[var(--line-soft)] transition-colors">
                      <td className="px-4 py-3 text-sm font-semibold text-[var(--ink)]">{app.full_name}</td>
                      <td className="px-4 py-3 text-xs text-[var(--ink-faint)]">{app.email}</td>
                      <td className="px-4 py-3 text-xs text-[var(--ink-faint)]">{app.phone}</td>
                      <td className="px-4 py-3 text-xs text-[var(--ink-soft)]">{app.course?.name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${app.payment_status==='paid'?'bg-[var(--ok-soft)] text-[var(--ok)]':'bg-[var(--warn-soft)] text-[var(--warn)]'}`}>
                          {app.payment_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--ink-faint)]">{app.marketer?.full_name || 'Direct'}</td>
                      <td className="px-4 py-3 text-[11px] text-[var(--ink-faint)]">{new Date(app.created_at).toLocaleDateString('en-GH')}</td>
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

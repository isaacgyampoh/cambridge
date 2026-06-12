'use client'
import { useState } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { formatGHS, formatDateTime } from '@/lib/utils'
import { DollarSign, TrendingUp, AlertCircle, Plus, RefreshCw, X } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const METHOD_COLOR: Record<string, string> = {
  cash: 'bg-green-100 text-green-700',
  paystack: 'bg-blue-100 text-blue-700',
  bank_transfer: 'bg-purple-100 text-purple-700',
  mobile_money: 'bg-yellow-100 text-yellow-800',
}

export default function FinancePage() {
  const [tab, setTab] = useState<'payments'|'invoices'>('payments')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ student_id:'', amount:'', method:'cash', notes:'' })
  const [saving, setSaving] = useState(false)

  const { data: payments, loading: loadP, refetch: refetchP } = useData({
    table: 'payments',
    select: '*, student:student_id(full_name, phone)',
    orderBy: 'created_at', limit: 100,
  })

  const { data: invoices, loading: loadI, refetch: refetchI } = useData({
    table: 'invoices',
    select: '*, student:student_id(full_name)',
    orderBy: 'created_at', limit: 100,
  })

  const { data: students } = useData({
    table: 'profiles',
    select: 'id, full_name, phone',
    filters: [{ col: 'role', op: 'eq', val: 'student' }, { col: 'is_active', op: 'eq', val: true }],
    orderBy: 'full_name', orderAsc: true,
  })

  const loading = loadP || loadI
  const totalRevenue = payments.filter(p => p.status === 'paid').reduce((a,p) => a + Number(p.amount), 0)
  const outstanding = invoices.reduce((a,i) => a + Number(i.outstanding || 0), 0)
  const todayRev = payments
    .filter(p => p.status==='paid' && p.paid_at?.startsWith(new Date().toISOString().slice(0,10)))
    .reduce((a,p) => a + Number(p.amount), 0)

  async function recordPayment() {
    if (!form.student_id || !form.amount) { toast.error('Select student and enter amount'); return }
    setSaving(true)
    try {
      await mutate('POST', 'payments', {
        student_id: form.student_id,
        amount: parseFloat(form.amount),
        method: form.method,
        status: 'paid',
        notes: form.notes || null,
        paid_at: new Date().toISOString(),
      })
      toast.success('✅ Payment recorded!')
      setShowModal(false)
      setForm({ student_id:'', amount:'', method:'cash', notes:'' })
      refetchP()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fade-in w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Finance</h1>
          <p className="text-gray-400 text-sm">Payments, invoices &amp; revenue</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 h-9 px-4 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition">
            <Plus size={14} /> Record Payment
          </button>
          <Link href="/finance/invoices/new"
            className="flex items-center gap-1.5 h-9 px-4 bg-white border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50 transition">
            <Plus size={14} /> Invoice
          </Link>
          <Link href="/finance/reports"
            className="flex items-center gap-1.5 h-9 px-4 bg-white border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50 transition">
            Reports
          </Link>
          <button onClick={() => { refetchP(); refetchI() }}
            className="h-9 w-9 flex items-center justify-center bg-white border border-gray-200 text-gray-500 rounded-xl hover:bg-gray-50 transition">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Revenue', value: formatGHS(totalRevenue), icon: TrendingUp, c: 'text-green-600 bg-green-50 border-green-100' },
          { label: "Today", value: formatGHS(todayRev), icon: DollarSign, c: 'text-blue-600 bg-blue-50 border-blue-100' },
          { label: 'Transactions', value: payments.filter(p=>p.status==='paid').length, icon: DollarSign, c: 'text-purple-600 bg-purple-50 border-purple-100' },
          { label: 'Outstanding', value: formatGHS(outstanding), icon: AlertCircle, c: outstanding>0?'text-red-600 bg-red-50 border-red-100':'text-green-600 bg-green-50 border-green-100' },
        ].map(s => (
          <div key={s.label} className={`bg-white rounded-2xl p-4 border ${s.c.split(' ')[2]}`}>
            <div className={`w-9 h-9 rounded-xl ${s.c.split(' ')[1]} flex items-center justify-center mb-2`}>
              <s.icon size={17} className={s.c.split(' ')[0]} />
            </div>
            <div className="text-lg font-bold text-gray-900">{s.value}</div>
            <div className="text-xs text-gray-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 overflow-y-auto p-4 flex items-start sm:items-center justify-center" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl my-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900">Record Payment</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 transition"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Student</label>
                <select value={form.student_id} onChange={e => setForm(f=>({...f,student_id:e.target.value}))}
                  className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-blue-500">
                  <option value="">Select student...</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Amount (GHS)</label>
                <input type="number" value={form.amount} onChange={e => setForm(f=>({...f,amount:e.target.value}))}
                  placeholder="0.00" className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Method</label>
                <div className="grid grid-cols-2 gap-2">
                  {[{v:'cash',l:'💵 Cash'},{v:'mobile_money',l:'📱 MoMo'},{v:'bank_transfer',l:'🏦 Bank'},{v:'paystack',l:'💳 Card'}].map(m => (
                    <button key={m.v} type="button" onClick={() => setForm(f=>({...f,method:m.v}))}
                      className={`h-10 rounded-xl text-sm font-semibold border-2 transition ${form.method===m.v?'border-blue-600 bg-blue-50 text-blue-700':'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      {m.l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Notes</label>
                <input value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))}
                  placeholder="Optional" className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={recordPayment} disabled={saving}
                className="flex-1 h-11 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition">
                {saving ? 'Saving...' : 'Record Payment'}
              </button>
              <button onClick={() => setShowModal(false)} className="flex-1 h-11 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4">
        {[{k:'payments',l:`Payments (${payments.length})`},{k:'invoices',l:`Invoices (${invoices.length})`}].map(t => (
          <button key={t.k} onClick={() => setTab(t.k as any)}
            className={`px-4 h-9 rounded-xl text-sm font-semibold transition ${tab===t.k?'bg-gray-900 text-white':'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'}`}>
            {t.l}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tab === 'payments' ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Receipt','Student','Amount','Method','Status','Date'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-16 text-gray-300">
                    <DollarSign size={32} className="mx-auto mb-2 opacity-50" />
                    <p>No payments yet. Record your first payment above.</p>
                  </td></tr>
                ) : payments.map(p => (
                  <tr key={p.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-[11px] font-mono text-gray-400">{p.receipt_number || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-gray-900">{p.student?.full_name || '—'}</div>
                      <div className="text-[11px] text-gray-400">{p.student?.phone}</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-gray-900">{formatGHS(p.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${METHOD_COLOR[p.method]||'bg-gray-100 text-gray-600'}`}>
                        {p.method?.replace(/_/g,' ') || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${p.status==='paid'?'bg-green-100 text-green-700':p.status==='pending'?'bg-yellow-100 text-yellow-700':'bg-red-100 text-red-600'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-gray-400">{formatDateTime(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Invoice #','Student','Total','Paid','Balance','Due Date'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-16 text-gray-300">
                    <p>No invoices yet.</p>
                    <Link href="/finance/invoices/new" className="text-blue-500 hover:underline text-sm">Create first invoice →</Link>
                  </td></tr>
                ) : invoices.map(inv => (
                  <tr key={inv.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-[11px] font-mono text-gray-400">{inv.invoice_number||'—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">{inv.student?.full_name||'—'}</td>
                    <td className="px-4 py-3 text-sm font-bold text-gray-900">{formatGHS(inv.total_amount)}</td>
                    <td className="px-4 py-3 text-sm text-green-600 font-semibold">{formatGHS(inv.amount_paid)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-bold ${Number(inv.outstanding)>0?'text-red-600':'text-green-600'}`}>
                        {formatGHS(inv.outstanding||0)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-gray-400">{inv.due_date||'No due date'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Payment, Invoice } from '@/types'
import { toast } from 'sonner'
import { DollarSign, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react'

export default function FinanceDashboard() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'payments' | 'invoices'>('payments')
  const sb = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: p }, { data: i }] = await Promise.all([
      sb.from('payments').select('*, student:student_id(full_name,phone)').order('created_at', { ascending: false }).limit(100),
      sb.from('invoices').select('*, student:student_id(full_name,phone)').order('created_at', { ascending: false }).limit(100),
    ])
    setPayments(p || [])
    setInvoices(i || [])
    setLoading(false)
  }

  const totalRevenue = payments.filter(p => p.status === 'paid').reduce((a, p) => a + Number(p.amount), 0)
  const pending = payments.filter(p => p.status === 'pending').reduce((a, p) => a + Number(p.amount), 0)
  const outstanding = invoices.reduce((a, i) => a + Number(i.outstanding), 0)
  const todayRevenue = payments
    .filter(p => p.status === 'paid' && p.paid_at?.startsWith(new Date().toISOString().slice(0, 10)))
    .reduce((a, p) => a + Number(p.amount), 0)

  const METHOD_COLORS: Record<string, string> = {
    paystack: 'bg-blue-100 text-blue-700',
    cash: 'bg-green-100 text-green-700',
    bank_transfer: 'bg-purple-100 text-purple-700',
    mobile_money: 'bg-yellow-100 text-yellow-700',
  }

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Finance</h1>
          <p className="text-gray-500 text-sm mt-0.5">Payments, invoices, and revenue</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Revenue', value: `GHS ${totalRevenue.toLocaleString('en-GH', { minimumFractionDigits: 2 })}`, icon: TrendingUp, color: 'text-green-600 bg-green-50' },
          { label: "Today's Revenue", value: `GHS ${todayRevenue.toFixed(2)}`, icon: DollarSign, color: 'text-blue-600 bg-blue-50' },
          { label: 'Pending', value: `GHS ${pending.toFixed(2)}`, icon: AlertCircle, color: 'text-yellow-600 bg-yellow-50' },
          { label: 'Outstanding', value: `GHS ${outstanding.toFixed(2)}`, icon: AlertCircle, color: 'text-red-600 bg-red-50' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-200">
            <div className={`w-10 h-10 rounded-xl ${s.color.split(' ')[1]} flex items-center justify-center mb-3`}>
              <s.icon size={20} className={s.color.split(' ')[0]} />
            </div>
            <div className="text-lg font-bold text-gray-900">{s.value}</div>
            <div className="text-sm text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {[{ key: 'payments', label: 'Payments' }, { key: 'invoices', label: 'Invoices' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${
              tab === t.key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" />
          </div>
        ) : tab === 'payments' ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Receipt', 'Student', 'Amount', 'Method', 'Status', 'Date'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{p.receipt_number || '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">{(p as any).student?.full_name || '—'}</td>
                    <td className="px-4 py-3 text-sm font-bold text-gray-900">GHS {Number(p.amount).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${METHOD_COLORS[p.method] || 'bg-gray-100 text-gray-600'}`}>
                        {p.method.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        p.status === 'paid' ? 'bg-green-100 text-green-700' :
                        p.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-600'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {new Date(p.created_at).toLocaleDateString('en-GH')}
                    </td>
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400">No payments yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Invoice #', 'Student', 'Total', 'Paid', 'Outstanding', 'Due Date'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{inv.invoice_number}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">{(inv as any).student?.full_name || '—'}</td>
                    <td className="px-4 py-3 text-sm font-bold">GHS {Number(inv.total_amount).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-green-600 font-semibold">GHS {Number(inv.amount_paid).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-bold ${Number(inv.outstanding) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        GHS {Number(inv.outstanding).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{inv.due_date || '—'}</td>
                  </tr>
                ))}
                {invoices.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400">No invoices yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

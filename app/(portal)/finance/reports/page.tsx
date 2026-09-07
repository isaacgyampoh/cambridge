'use client'
import { useState, useEffect, useCallback } from 'react'

import { formatGHS } from '@/lib/utils'
import { DollarSign, TrendingUp, AlertCircle } from 'lucide-react'
import { LoadingState, ErrorState, PageHeader } from '@/components/ui'
import { apiQuery, ApiQueryError } from '@/lib/api/query'

type PaymentRow = {
  amount: number | string
  status: string
  method: string
  paid_at: string | null
  created_at: string
  student?: { full_name: string } | null
}

export type InvoiceRow = {
  id: string
  invoice_number: string | null
  outstanding: number | string
  student?: { full_name: string } | null
}

type Report = {
  totalRevenue: number
  txCount: number
  avgTx: number
  byMethod: Record<string, number>
  outstanding: InvoiceRow[]
  totalOutstanding: number
  daily: Record<string, number>
}

export default function FinanceReports() {
  const [data, setData] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState('30')

  /*
   * The effect used to call `load()`, which was declared BELOW it and set
   * state synchronously. Two problems in one line: React 19 counts that as a
   * cascading render, and the effect depended on a binding that only existed
   * through hoisting, so the linter could not see when it changed.
   *
   * `load` is now a useCallback declared before its effect, which makes the
   * dependency real and the ordering explicit.
   */
  const load = useCallback(async () => {
    const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString()

    /*
     * Wrapped, because apiQuery now throws instead of returning an empty
     * array. It used to swallow a 401 or a 500 and hand back [], which drew
     * this page with revenue at GHS 0.00 and nothing outstanding — a month
     * that took in nothing, rendered with the same confidence as a real one.
     * On the finance report that is the worst possible way to fail.
     */
    try {
      const [payments, invoices] = await Promise.all([
        apiQuery<PaymentRow>('payments', '*,student:student_id(full_name)', { filters: [{ col: 'created_at', op: 'gte', val: since }] }),
        apiQuery<InvoiceRow>('invoices', '*,student:student_id(full_name)', { orderBy: 'outstanding', orderAsc: false }),
      ])

      const paid = payments.filter(x => x.status === 'paid')
      const byMethod: Record<string, number> = {}
      paid.forEach(x => { byMethod[x.method] = (byMethod[x.method] || 0) + Number(x.amount) })

      // Daily revenue trend
      const daily: Record<string, number> = {}
      for (let i = Math.min(parseInt(range), 30) - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
        daily[d] = 0
      }
      paid.forEach(x => {
        const d = x.paid_at?.slice(0, 10) || x.created_at.slice(0, 10)
        if (daily[d] !== undefined) daily[d] += Number(x.amount)
      })

      const total = paid.reduce((a, x) => a + Number(x.amount), 0)

      setData({
        totalRevenue: total,
        txCount: paid.length,
        avgTx: paid.length ? total / paid.length : 0,
        byMethod,
        outstanding: invoices.filter(i => Number(i.outstanding) > 0),
        totalOutstanding: invoices.reduce((a, i) => a + Number(i.outstanding), 0),
        daily,
      })
      setError(null)
    } catch (e) {
      setData(null)
      setError(e instanceof ApiQueryError ? e.userMessage : 'This report could not be loaded. Please try again.')
    }
  }, [range])

  useEffect(() => { load() }, [load])

  if (error) return <ErrorState title="The report did not load" message={error} onRetry={load} />
  if (!data) return <LoadingState />

  const maxDaily = Math.max(...Object.values(data.daily as Record<string, number>), 1)

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Finance"
        title="Finance reports"
        description="Revenue, payment methods and what is still outstanding."
        actions={
        <select value={range} onChange={e => setRange(e.target.value)} className="h-10 px-4 rounded-2xl border border-[var(--line)] text-sm bg-[var(--paper)] focus:outline-none">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Revenue', value: formatGHS(data.totalRevenue), icon: DollarSign, color: 'text-[var(--ok)] bg-[var(--ok-soft)]'},
          { label: 'Transactions', value: data.txCount, icon: TrendingUp, color: 'text-[var(--accent)] bg-[var(--accent-soft)]'},
          { label: 'Avg Transaction', value: formatGHS(data.avgTx), icon: TrendingUp, color: 'text-[var(--gold)] bg-[var(--gold-soft)]'},
          { label: 'Outstanding', value: formatGHS(data.totalOutstanding), icon: AlertCircle, color: 'text-[var(--danger)] bg-[var(--danger-soft)]'},
        ].map(k => (
          <div key={k.label} className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-4">
            <div className={`w-10 h-10 rounded-xl ${k.color.split(' ')[1]} flex items-center justify-center mb-3`}>
              <k.icon size={20} className={k.color.split(' ')[0]} />
            </div>
            <div className="font-display text-xl font-semibold text-[var(--ink)]">{k.value}</div>
            <div className="text-sm text-[var(--ink-faint)] mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Revenue chart */}
      <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5 mb-5">
        <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Daily Revenue</h3>
        <div className="flex items-end gap-1 h-32">
          {Object.entries(data.daily).slice(-30).map(([date, amount]) => (
            <div key={date} className="flex-1 flex flex-col items-center gap-1 group relative">
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[var(--ink)] text-white text-[11px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10 transition">
                {date.slice(5)}: GHS {amount.toFixed(0)}
              </div>
              <div className="w-full bg-[var(--accent)] rounded-t transition-all hover:bg-[var(--accent)]"
                style={{ height: `${Math.round((amount / maxDaily) * 100)}%`, minHeight: amount > 0 ? '4px': '0'}} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-[var(--ink-faint)] mt-1">
          <span>{Object.keys(data.daily)[0]?.slice(5)}</span>
          <span>{Object.keys(data.daily).slice(-1)[0]?.slice(5)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* By method */}
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
          <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Revenue by Payment Method</h3>
          <div className="space-y-3">
            {Object.entries(data.byMethod).sort((a, b) => b[1] - a[1]).map(([method, amt]) => (
              <div key={method}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium capitalize text-[var(--ink-soft)]">{method.replace(/_/g, ' ')}</span>
                  <span className="font-semibold text-[var(--ink)]">{formatGHS(amt)}</span>
                </div>
                <div className="h-2 bg-[var(--line-soft)] rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--ok)] rounded-full" style={{ width: `${Math.round(amt / data.totalRevenue * 100)}%` }} />
                </div>
              </div>
            ))}
            {Object.keys(data.byMethod).length === 0 && <p className="text-sm text-[var(--ink-faint)] text-center py-4">No data</p>}
          </div>
        </div>

        {/* Outstanding balances */}
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
          <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Outstanding Balances</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {data.outstanding.slice(0, 20).map(inv => (
              <div key={inv.id} className="flex items-center justify-between py-2 border-b border-[var(--line-soft)]">
                <div>
                  <div className="text-sm font-semibold text-[var(--ink)]">{inv.student?.full_name || '—'}</div>
                  <div className="text-xs text-[var(--ink-faint)]">{inv.invoice_number}</div>
                </div>
                <span className="text-sm font-bold text-[var(--danger)]">{formatGHS(inv.outstanding)}</span>
              </div>
            ))}
            {data.outstanding.length === 0 && <p className="text-sm text-[var(--ink-faint)] text-center py-4">No outstanding balances </p>}
          </div>
        </div>
      </div>
    </div>
  )
}

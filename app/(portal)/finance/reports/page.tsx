'use client'
import { useState, useEffect } from 'react'

import { formatGHS } from '@/lib/utils'
import { DollarSign, TrendingUp, AlertCircle, Users } from 'lucide-react'


async function apiQuery(table: string, select: string, filters?: { col: string; op: string; val: any }[], orderBy?: string, orderAsc?: boolean, limit = 2000) {
  const params = new URLSearchParams({ table, select, limit: String(limit) })
  if (filters?.length) params.set('filters', JSON.stringify(filters))
  if (orderBy) { params.set('orderBy', orderBy); if (orderAsc !== undefined) params.set('orderAsc', String(orderAsc)) }
  const res = await fetch(`/api/data?${params}`)
  const json = await res.json()
  return json.data || []
}

export default function FinanceReports() {
  const [data, setData] = useState<any>(null)
  const [range, setRange] = useState('30')
  useEffect(() => { load() }, [range])

  async function load() {
    const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString()
    const [payments, invoices] = await Promise.all([
      apiQuery('payments', '*,student:student_id(full_name)', [{ col: 'created_at', op: 'gte', val: since }]),
      apiQuery('invoices', '*,student:student_id(full_name)', undefined, 'outstanding', false),
    ])

    const p: any[] = payments
    const paid = p.filter((x: any) => x.status === 'paid')
    const byMethod: Record<string, number> = {}
    paid.forEach((x: any) => { byMethod[x.method] = (byMethod[x.method] || 0) + Number(x.amount) })

    // Daily revenue trend
    const daily: Record<string, number> = {}
    for (let i = Math.min(parseInt(range), 30) - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
      daily[d] = 0
    }
    paid.forEach((x: any) => {
      const d = x.paid_at?.slice(0, 10) || x.created_at.slice(0, 10)
      if (daily[d] !== undefined) daily[d] += Number(x.amount)
    })

    const inv: any[] = invoices

    setData({
      totalRevenue: paid.reduce((a: number, x: any) => a + Number(x.amount), 0),
      txCount: paid.length,
      avgTx: paid.length ? paid.reduce((a: number, x: any) => a + Number(x.amount), 0) / paid.length : 0,
      byMethod,
      outstanding: inv.filter((i: any) => Number(i.outstanding) > 0),
      totalOutstanding: inv.reduce((a: number, i: any) => a + Number(i.outstanding), 0),
      daily,
    })
  }

  if (!data) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>

  const maxDaily = Math.max(...Object.values(data.daily as Record<string, number>), 1)

  return (
    <div className="fade-in w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Finance Reports</h1>
          <p className="text-[var(--ink-faint)] text-sm mt-0.5">Revenue and payment analytics</p>
        </div>
        <select value={range} onChange={e => setRange(e.target.value)} className="h-10 px-4 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Revenue', value: formatGHS(data.totalRevenue), icon: DollarSign, color: 'text-[var(--ok)] bg-[var(--ok-soft)]'},
          { label: 'Transactions', value: data.txCount, icon: TrendingUp, color: 'text-[var(--accent)] bg-[var(--accent-soft)]'},
          { label: 'Avg Transaction', value: formatGHS(data.avgTx), icon: TrendingUp, color: 'text-purple-600 bg-purple-50'},
          { label: 'Outstanding', value: formatGHS(data.totalOutstanding), icon: AlertCircle, color: 'text-[var(--danger)] bg-[var(--danger-soft)]'},
        ].map(k => (
          <div key={k.label} className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-4">
            <div className={`w-10 h-10 rounded-xl ${k.color.split(' ')[1]} flex items-center justify-center mb-3`}>
              <k.icon size={20} className={k.color.split(' ')[0]} />
            </div>
            <div className="font-display text-xl font-semibold text-[var(--ink)]">{k.value}</div>
            <div className="text-sm text-[var(--ink-faint)] mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Revenue chart */}
      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5 mb-5">
        <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Daily Revenue</h3>
        <div className="flex items-end gap-1 h-32">
          {Object.entries(data.daily).slice(-30).map(([date, amount]: any) => (
            <div key={date} className="flex-1 flex flex-col items-center gap-1 group relative">
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10 transition">
                {date.slice(5)}: GHS {amount.toFixed(0)}
              </div>
              <div className="w-full bg-blue-500 rounded-t transition-all hover:bg-[var(--accent)]"
                style={{ height: `${Math.round((amount / maxDaily) * 100)}%`, minHeight: amount > 0 ? '4px': '0'}} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-[var(--ink-faint)] mt-1">
          <span>{Object.keys(data.daily)[0]?.slice(5)}</span>
          <span>{Object.keys(data.daily).slice(-1)[0]?.slice(5)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* By method */}
        <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
          <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Revenue by Payment Method</h3>
          <div className="space-y-3">
            {Object.entries(data.byMethod).sort((a: any, b: any) => b[1] - a[1]).map(([method, amt]: any) => (
              <div key={method}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium capitalize text-[var(--ink-soft)]">{method.replace(/_/g, ' ')}</span>
                  <span className="font-semibold text-[var(--ink)]">{formatGHS(amt)}</span>
                </div>
                <div className="h-2 bg-[var(--line-soft)] rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.round(amt / data.totalRevenue * 100)}%` }} />
                </div>
              </div>
            ))}
            {Object.keys(data.byMethod).length === 0 && <p className="text-sm text-[var(--ink-faint)] text-center py-4">No data</p>}
          </div>
        </div>

        {/* Outstanding balances */}
        <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
          <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Outstanding Balances</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {data.outstanding.slice(0, 20).map((inv: any) => (
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

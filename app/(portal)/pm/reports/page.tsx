'use client'
import { useState, useEffect, useCallback } from 'react'

import { DataTable, type Column } from '@/components/ui/DataTable'
import { LoadingState, ErrorState } from '@/components/ui'
import { apiQuery, ApiQueryError } from '@/lib/api/query'

type MarketerRow = { name: string; total: number; converted: number }

type LeadRow = {
  source: string
  status: string
  assigned_to: string | null
  assignee?: { full_name: string } | null
}

type Report = {
  total: number
  bySource: Record<string, number>
  byStatus: Record<string, number>
  byMarketer: Record<string, MarketerRow>
  conversionRate: number
}

export default function PMReports() {
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
     * Wrapped, because apiQuery now throws rather than returning []. A 401 or
     * a 500 used to come back as an empty array and draw this page as a month
     * with no leads at all — and a marketer board with nobody on it, which is
     * the figure a project manager acts on.
     */
    try {
      const leads = await apiQuery<LeadRow>('leads', '*, assignee:assigned_to(full_name)', {
        filters: [{ col: 'created_at', op: 'gte', val: since }],
      })

      const total = leads.length
      const bySource: Record<string, number> = {}
      const byStatus: Record<string, number> = {}
      const byMarketer: Record<string, MarketerRow> = {}

      leads.forEach(lead => {
        bySource[lead.source] = (bySource[lead.source] || 0) + 1
        byStatus[lead.status] = (byStatus[lead.status] || 0) + 1
        if (lead.assigned_to) {
          const name = lead.assignee?.full_name || 'Unknown'
          if (!byMarketer[lead.assigned_to]) byMarketer[lead.assigned_to] = { name, total: 0, converted: 0 }
          byMarketer[lead.assigned_to].total++
          if (['ready_to_join', 'registered'].includes(lead.status)) byMarketer[lead.assigned_to].converted++
        }
      })

      setData({ total, bySource, byStatus, byMarketer, conversionRate: total ? Math.round((byStatus.ready_to_join || 0) / total * 100) : 0 })
      setError(null)
    } catch (e) {
      setData(null)
      setError(e instanceof ApiQueryError ? e.userMessage : 'This report could not be loaded. Please try again.')
    }
  }, [range])

  useEffect(() => { load() }, [load])

  if (error) return <ErrorState title="The report did not load" message={error} onRetry={load} />
  if (!data) return <LoadingState />

  const marketerRows: MarketerRow[] = Object.values(data.byMarketer)
    .sort((a, b) => b.converted - a.converted)

  const marketerColumns: Column<MarketerRow>[] = [
    { key: 'name', header: 'Marketer', primary: true, render: m => m.name },
    { key: 'assigned', header: 'Assigned', numeric: true, render: m => m.total },
    {
      key: 'converted', header: 'Converted', numeric: true,
      render: m => <span className="font-bold text-[var(--ok)]">{m.converted}</span>,
    },
    {
      key: 'rate', header: 'Conversion', numeric: true,
      render: m => <span className="font-bold">{m.total ? Math.round(m.converted / m.total * 100) : 0}%</span>,
    },
  ]

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Marketing Reports</h1>
          <p className="text-[var(--ink-faint)] text-sm mt-0.5">Lead pipeline analytics</p>
        </div>
        <select value={range} onChange={e => setRange(e.target.value)} className="h-10 px-4 rounded-2xl border border-[var(--line)] text-sm bg-[var(--paper)] focus:outline-none">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
        </select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Leads', value: data.total },
          { label: 'Conversion Rate', value: `${data.conversionRate}%` },
          { label: 'Ready to Join', value: data.byStatus.ready_to_join || 0 },
          { label: 'Registered', value: data.byStatus.registered || 0 },
        ].map(k => (
          <div key={k.label} className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5 text-center">
            <div className="text-3xl font-semibold text-[var(--ink)]">{k.value}</div>
            <div className="text-sm text-[var(--ink-faint)] mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* By Source */}
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
          <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Leads by Source</h3>
          <div className="space-y-3">
            {Object.entries(data.bySource).sort((a, b) => b[1] - a[1]).map(([source, count]) => (
              <div key={source}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium capitalize text-[var(--ink-soft)]">{source}</span>
                  <span className="font-semibold text-[var(--ink)]">{count}</span>
                </div>
                <div className="h-2 bg-[var(--line-soft)] rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--accent)] rounded-full" style={{ width: `${Math.round(count / data.total * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* By Status */}
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
          <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Pipeline Status</h3>
          <div className="space-y-3">
            {Object.entries(data.byStatus).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
              <div key={status}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium capitalize text-[var(--ink-soft)]">{status.replace(/_/g,' ')}</span>
                  <span className="font-semibold text-[var(--ink)]">{count}</span>
                </div>
                <div className="h-2 bg-[var(--line-soft)] rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--ok)] rounded-full" style={{ width: `${Math.round(count / data.total * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Marketer performance */}
      <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
        <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Marketer Performance</h3>
        <DataTable<MarketerRow>
          caption="Marketer performance"
          rows={marketerRows}
          rowKey={m => m.name}
          columns={marketerColumns}
          emptyTitle="No marketer data yet"
          emptyMessage="Figures appear once leads have been assigned and worked."
        />
      </div>
    </div>
  )
}

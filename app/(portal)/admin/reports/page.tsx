'use client'
import { useState, useEffect, useCallback } from 'react'

import { formatGHS } from '@/lib/utils'
import { LoadingState, ErrorState, PageHeader } from '@/components/ui'
import { apiQuery, ApiQueryError } from '@/lib/api/query'

/*
 * The columns this page asks for, named. `select` above and the reads below
 * used to have nothing holding them together: adding a column to one and
 * forgetting the other was a runtime undefined, and the totals it fed were
 * wrong without being empty.
 */
type LeadRow = { source: string; status: string; created_at: string; assigned_to: string | null }
type AdmissionRow = { status: string; created_at: string }
type PaymentRow = { amount: number | string; status: string; method: string; paid_at: string | null }
type BatchRow = { status: string; class_type: string }

/** What the page renders. Named so `data` is not `any`. */
type Report = {
  totalLeads: number
  converted: number
  unassigned: number
  bySource: Record<string, number>
  totalAdmissions: number
  admitted: number
  byAdmStatus: Record<string, number>
  revenue: number
  txCount: number
  totalStudents: number
  ongoingBatches: number
  upcomingBatches: number
}

export default function AdminReports() {
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
     * Wrapped, because apiQuery now throws instead of handing back an empty
     * array. It used to swallow a 401 or a 500 and return [], which drew this
     * page with every figure at zero — a report of a month that brought in
     * nothing, indistinguishable from the real thing.
     */
    try {
      const [leads, admissions, payments, students, batches] = await Promise.all([
        apiQuery<LeadRow>('leads', 'source,status,created_at,assigned_to', { filters: [{ col: 'created_at', op: 'gte', val: since }] }),
        apiQuery<AdmissionRow>('admissions', 'status,created_at', { filters: [{ col: 'created_at', op: 'gte', val: since }] }),
        apiQuery<PaymentRow>('payments', 'amount,status,method,paid_at', { filters: [{ col: 'created_at', op: 'gte', val: since }] }),
        apiQuery<{ id: string }>('profiles', 'id', { filters: [{ col: 'role', op: 'eq', val: 'student' }, { col: 'is_active', op: 'eq', val: true }] }),
        apiQuery<BatchRow>('batches', 'status,class_type'),
      ])

      const paidPayments = payments.filter(x => x.status === 'paid')
      const bySource: Record<string, number> = {}
      leads.forEach(x => { bySource[x.source] = (bySource[x.source] || 0) + 1 })

      const byAdmStatus: Record<string, number> = {}
      admissions.forEach(x => { byAdmStatus[x.status] = (byAdmStatus[x.status] || 0) + 1 })

      setData({
        totalLeads: leads.length,
        converted: leads.filter(x => ['ready_to_join', 'registered'].includes(x.status)).length,
        unassigned: leads.filter(x => !x.assigned_to).length,
        bySource,
        totalAdmissions: admissions.length,
        admitted: byAdmStatus.admitted || 0,
        byAdmStatus,
        revenue: paidPayments.reduce((a, x) => a + Number(x.amount), 0),
        txCount: paidPayments.length,
        totalStudents: students.length,
        ongoingBatches: batches.filter(b => b.status === 'ongoing').length,
        upcomingBatches: batches.filter(b => b.status === 'upcoming').length,
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

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Insight"
        title="System reports"
        description="Leads, admissions, revenue and enrolment across the centre."
        actions={
        <select value={range} onChange={e => setRange(e.target.value)} className="h-10 px-4 rounded-2xl border border-[var(--line)] text-sm bg-[var(--paper)] focus:outline-none">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">All time</option>
        </select>
        }
      />

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Leads', value: data.totalLeads, sub: `${data.unassigned} unassigned`, color: 'bg-[var(--accent-soft)] text-[var(--accent)]' },
          { label: 'Conversion Rate', value: `${data.totalLeads ? Math.round(data.converted/data.totalLeads*100) : 0}%`, sub: `${data.converted} converted`, color: 'bg-[var(--ok-soft)] text-[var(--ok)]' },
          { label: 'Revenue', value: formatGHS(data.revenue), sub: `${data.txCount} transactions`, color: 'bg-[var(--ok-soft)] text-[var(--ok)]' },
          { label: 'Total Students', value: data.totalStudents, sub: `${data.ongoingBatches} active classes`, color: 'bg-[var(--gold-soft)] text-[var(--gold)]' },
          { label: 'Admissions', value: data.totalAdmissions, sub: `${data.admitted} admitted`, color: 'bg-[var(--accent-soft)] text-[var(--accent)]' },
          { label: 'Ongoing Batches', value: data.ongoingBatches, sub: `${data.upcomingBatches} upcoming`, color: 'bg-[var(--warn-soft)] text-[var(--warn)]' },
        ].map(k => (
          <div key={k.label} className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-4">
            <div className={`text-2xl font-bold ${k.color.split(' ')[1]}`}>{k.value}</div>
            <div className="text-sm font-semibold text-[var(--ink-soft)] mt-0.5">{k.label}</div>
            <div className="text-xs text-[var(--ink-faint)] mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Lead sources */}
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
          <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Leads by Source</h3>
          <div className="space-y-2">
            {Object.entries(data.bySource).sort((a, b) => b[1] - a[1]).map(([src, cnt]) => (
              <div key={src}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="capitalize font-medium text-[var(--ink-soft)]">{src}</span>
                  <span className="font-bold">{cnt} ({data.totalLeads ? Math.round(cnt/data.totalLeads*100) : 0}%)</span>
                </div>
                <div className="h-1.5 bg-[var(--line-soft)] rounded-full">
                  <div className="h-full bg-[var(--accent)] rounded-full" style={{ width: `${data.totalLeads ? Math.round(cnt/data.totalLeads*100) : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Admission pipeline */}
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
          <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Admission Pipeline</h3>
          <div className="space-y-2">
            {Object.entries(data.byAdmStatus).sort((a, b) => b[1] - a[1]).map(([status, cnt]) => (
              <div key={status} className="flex items-center justify-between py-2 border-b border-[var(--line-soft)] last:border-0">
                <span className="text-sm capitalize text-[var(--ink-soft)]">{status.replace(/_/g,' ')}</span>
                <span className="text-sm font-semibold text-[var(--ink)]">{cnt}</span>
              </div>
            ))}
            {Object.keys(data.byAdmStatus).length === 0 && <p className="text-xs text-[var(--ink-faint)] text-center py-4">No data</p>}
          </div>
        </div>

        {/* Quick actions */}
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
          <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Quick Actions</h3>
          <div className="space-y-2">
            {[
              { label: 'View all leads', href: '/admin/leads' },
              { label: 'Manage courses', href: '/admin/courses' },
              { label: 'View classes', href: '/admin/classes' },
              { label: 'Manage staff', href: '/admin/staff' },
              { label: 'Finance overview', href: '/admin/finance' },
              { label: 'System settings', href: '/admin/settings' },
            ].map(a => (
              <a key={a.href} href={a.href}
                className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-[var(--line-soft)] transition text-sm font-medium text-[var(--ink-soft)] hover:text-[var(--accent)]">
                {a.label}
                
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'
import { useState } from 'react'
import { displayPhone } from '@/lib/ui/contact'
import { useData } from '@/hooks/useData'
import type { Lead } from '@/types'
import { formatDateTime } from '@/lib/utils'
import Link from 'next/link'
import {
  PageHeader, Card, Button, Badge, Spinner, EmptyState, Search, ActionMenu,
} from '@/components/ui'
import { describeStatus } from '@/lib/ui/status'
import { exportToExcel } from '@/lib/utils/export'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/useConfirm'

const STATUS_TONE: Record<string, any> = {
  new: 'neutral', contacted: 'accent', interested: 'accent', follow_up: 'warning',
  ready_to_join: 'success', registered: 'success', not_interested: 'muted', lost: 'danger',
}


/**
 * What a bulk purge is about to do.
 *
 * These three actions delete leads irreversibly, and the counts — how many go,
 * how many are protected — are the entire basis for the decision. window.confirm
 * could only approximate this with \n, which renders as nothing in HTML, so the
 * operator was reading a wall of text with the important number buried in it.
 */
function PurgeSummary({
  intro, total, toDelete, protectedCount, byStatus,
}: {
  intro: string
  total?: number
  toDelete: number
  protectedCount: number
  byStatus?: Record<string, number>
}) {
  return (
    <>
      <p className="mb-3">{intro}</p>
      {byStatus && Object.keys(byStatus).length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3 text-[13px]">
          {Object.entries(byStatus).map(([status, n]) => (
            <div key={status} className="flex justify-between gap-2">
              <dt className="capitalize text-[var(--ink-faint)]">{status.replace(/_/g, ' ')}</dt>
              <dd className="tabular-nums">{n}</dd>
            </div>
          ))}
        </dl>
      )}
      <ul className="space-y-1 text-[13px]">
        {total !== undefined && (
          <li className="flex justify-between gap-2">
            <span className="text-[var(--ink-faint)]">Total leads</span>
            <span className="tabular-nums">{total}</span>
          </li>
        )}
        <li className="flex justify-between gap-2 font-semibold text-[var(--danger)]">
          <span>Will be deleted</span><span className="tabular-nums">{toDelete}</span>
        </li>
        <li className="flex justify-between gap-2 text-[var(--ok)]">
          <span>Protected (registered or paid)</span><span className="tabular-nums">{protectedCount}</span>
        </li>
      </ul>
      <p className="mt-3 font-medium text-[var(--ink)]">This cannot be undone.</p>
    </>
  )
}

export default function AdminLeads() {
  const { confirm, dialog } = useConfirm()
  const { data: leads, loading, refetch } = useData<Lead>({
    table: 'leads',
    select: '*, assignee:assigned_to(full_name), assigner:assigned_by(full_name)',
    orderBy: 'created_at', orderAsc: false, limit: 500,
  })
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const filtered = leads.filter((l: any) => {
    const matchSearch = !search || [l.full_name, l.email, l.phone, l.course_interest].some(v => v?.toLowerCase().includes(search.toLowerCase()))
    const matchSource = sourceFilter === 'all' || l.source === sourceFilter
    const matchStatus = statusFilter === 'all' || l.status === statusFilter
    return matchSearch && matchSource && matchStatus
  })

  async function assignUnassigned() {
    // First check the pool so we can explain if nothing happens
    const diag = await fetch('/api/leads/assign-unassigned').then(r => r.json()).catch(() => null)
    if (!diag) { toast.error('Could not check leads.'); return }
    if (diag.unassigned === 0) { toast.info('No unassigned leads to distribute.'); return }
    if (diag.poolSize === 0) { toast.error(diag.reason || 'No one is in the lead pool. Add an active marketer first.'); return }
    if (!await confirm({
      title: 'Distribute unassigned leads?',
      message: `${diag.unassigned} lead${diag.unassigned === 1 ? '' : 's'} will be shared across ${diag.poolSize} marketer${diag.poolSize === 1 ? '' : 's'}, and each will be notified.`,
      confirmLabel: 'Distribute',
      tone: 'accent',
    })) return
    toast.loading('Assigning…', { id: 'assign' })
    const d = await fetch('/api/leads/assign-unassigned', { method: 'POST' }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    if (d.success) { toast.success(`Assigned ${d.assigned} lead(s).`, { id: 'assign' }); refetch() }
    else toast.error(d.error || 'Could not assign', { id: 'assign' })
  }


  /*
   * The bulk clean-up operations.
   *
   * These were written inline inside the header's actions prop — four
   * multi-line async bodies embedded in JSX, which is why the header had grown
   * to sixty lines and why the destructive ones were indistinguishable from
   * "Export to Excel". Named here so the menu can describe what each one does.
   */

  async function keepOnlyRegistered() {
    const dry = await fetch('/api/admin/purge-leads').then(r => r.json()).catch(() => null)
    if (!dry || dry.error) { toast.error(dry?.error || 'Could not check'); return }
    if (!await confirm({
      title: 'Keep only registered leads?',
      confirmLabel: `Delete ${dry.toDelete} leads`,
      message: <PurgeSummary
        intro="Every lead that has not registered will be removed."
        toDelete={dry.toDelete} protectedCount={dry.protected} byStatus={dry.byStatus} />,
    })) return
    toast.loading('Cleaning up…', { id: 'purge' })
    const d = await fetch('/api/admin/purge-leads', { method: 'POST' })
      .then(r => r.json()).catch(() => ({ error: 'failed' }))
    if (d.error) toast.error(d.error, { id: 'purge' })
    else { toast.success(`Deleted ${d.deleted}. ${d.remaining} registered leads remain.`, { id: 'purge' }); refetch?.() }
  }

  async function keepOnlyAssigned() {
    const dry = await fetch('/api/admin/purge-leads?mode=keep_assigned').then(r => r.json()).catch(() => null)
    if (!dry || dry.error) { toast.error(dry?.error || 'Could not check'); return }
    if (!await confirm({
      title: 'Remove every unassigned lead?',
      confirmLabel: `Delete ${dry.toDelete} leads`,
      message: <PurgeSummary
        intro="Leads that do not belong to a marketer will be removed."
        total={dry.total} toDelete={dry.toDelete} protectedCount={dry.protected} />,
    })) return
    toast.loading('Cleaning up…', { id: 'purge2' })
    const d = await fetch('/api/admin/purge-leads?mode=keep_assigned', { method: 'POST' })
      .then(r => r.json()).catch(() => ({ error: 'failed' }))
    if (d.error) toast.error(d.error, { id: 'purge2' })
    else { toast.success(`Deleted ${d.deleted}. ${d.remaining} leads remain.`, { id: 'purge2' }); refetch?.() }
  }

  async function tidyUpLeads() {
    // Give any unassigned lead an owner first (registered ones are NOT sent the
    // sales greeting), then clear the rest.
    toast.loading('Assigning unassigned leads…', { id: 'clean' })
    await fetch('/api/leads/assign-unassigned', { method: 'POST' }).catch(() => {})
    const dry = await fetch('/api/admin/purge-leads?mode=keep_clean').then(r => r.json()).catch(() => null)
    if (!dry || dry.error) { toast.error(dry?.error || 'Could not check', { id: 'clean' }); return }
    toast.dismiss('clean')
    if (!await confirm({
      title: 'Tidy up leads?',
      confirmLabel: `Delete ${dry.toDelete} leads`,
      message: <PurgeSummary
        intro="Keeps everyone who registered or belongs to a marketer. The rest are removed."
        total={dry.total} toDelete={dry.toDelete} protectedCount={dry.protected} />,
    })) return
    toast.loading('Cleaning up…', { id: 'clean' })
    const d = await fetch('/api/admin/purge-leads?mode=keep_clean', { method: 'POST' })
      .then(r => r.json()).catch(() => ({ error: 'failed' }))
    if (d.error) toast.error(d.error, { id: 'clean' })
    else { toast.success(`Deleted ${d.deleted}. ${d.remaining} leads remain — all registered or assigned.`, { id: 'clean' }); refetch?.() }
  }

  async function clearAllLeads() {
    const typed = prompt('This permanently deletes EVERY lead (and their activity/chat history) so you can import fresh. Students, staff and courses are NOT affected.\n\nType exactly:  DELETE ALL LEADS')
    if (typed !== 'DELETE ALL LEADS') { if (typed !== null) toast.error('Confirmation did not match. Nothing deleted.'); return }
    toast.loading('Deleting all leads…', { id: 'clr' })
    const d = await fetch('/api/admin/clear-leads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE ALL LEADS' }),
    }).then(r => r.json()).catch(() => ({ error: 'Request failed' }))
    if (d.success) { toast.success(`Deleted ${d.deleted} lead(s). You can import fresh now.`, { id: 'clr' }); refetch() }
    else toast.error(d.error || 'Could not delete leads', { id: 'clr' })
  }

  async function exportExcel() {
    const rows = filtered.map((l: any) => ({
      Name: l.full_name,
      Phone: displayPhone(l.phone) || '',
      Email: l.email || '',
      Source: l.source,
      Stage: l.status?.replace(/_/g, ' '),
      Course: l.course_interest || '',
      Owner: l.assignee?.full_name || 'Unassigned',
      Added: formatDateTime(l.created_at),
    }))
    if (!rows.length) return
    await exportToExcel(rows, `cce-leads-${new Date().toISOString().slice(0, 10)}`, 'Leads')
  }

  async function exportCSV() {
    const rows = filtered.map((l: any) => [
      l.full_name, l.email || '', l.phone || '', l.source, l.status,
      l.course_interest || '', l.assignee?.full_name || '', formatDateTime(l.created_at)
    ].map(v => `"${v}"`).join(','))
    const csv = 'Name,Email,Phone,Source,Status,Course,Assigned To,Date\n' + rows.join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `cce-leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      {dialog}
      <PageHeader
        eyebrow="CRM"
        title="Leads"
        description="Every prospective student, with their source, stage and owner."
        actions={
          /*
           * Two actions and a menu, not nine buttons.
           *
           * Nine equal-weight buttons in a header is not a toolbar, it is a
           * wall — and four of these delete leads in bulk, sitting alongside
           * "Excel" with the same visual weight. The everyday actions stay
           * visible; everything rarer, and everything destructive, moves into
           * the menu where it can be labelled as what it is.
           */
          <>
            <Button variant="secondary" href="/admin/leads/import">Import</Button>
            <Button href="/admin/leads/new">Add lead</Button>
            <ActionMenu
              label="More lead actions"
              title="Lead actions"
              actions={[
                { label: 'Export to Excel', onClick: exportExcel },
                { label: 'Export to CSV', onClick: exportCSV },
                { label: 'Assign unassigned leads', onClick: assignUnassigned },
                { label: 'Keep only registered', onClick: keepOnlyRegistered,
                  tone: 'danger', hint: 'Deletes everyone who has not registered' },
                { label: 'Keep only assigned', onClick: keepOnlyAssigned,
                  tone: 'danger', hint: 'Deletes leads with no marketer' },
                { label: 'Tidy up leads', onClick: tidyUpLeads,
                  tone: 'danger', hint: 'Keeps registered and assigned only' },
                { label: 'Delete all leads', onClick: clearAllLeads,
                  tone: 'danger', hint: 'Removes every lead' },
              ]}
            />
          </>
        }
      />

      {/*
        Filters on one line.

        These were built from inputClass with a .replace('h-11') that no longer
        matches anything, so the substitution silently did nothing and the
        controls kept w-full — which is why they stacked full width down the
        page instead of sitting in a row.
      */}
      <div className="flex flex-col sm:flex-row gap-2.5 mb-5">
        <Search
          value={search}
          onChange={setSearch}
          placeholder="Search by name, email or phone"
          label="Search leads"
          className="flex-1 min-w-0"
        />
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          aria-label="Filter by source"
          className="h-12 sm:h-11 px-3 rounded-lg border border-[var(--line)] bg-white
            text-[15px] sm:text-[13px] text-[var(--ink)] sm:w-[150px]
            focus:outline-none focus:border-[var(--accent)]">
          <option value="all">All sources</option>
          {['facebook', 'google', 'linkedin', 'website', 'referral', 'manual'].map(x => (
            <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          aria-label="Filter by stage"
          className="h-12 sm:h-11 px-3 rounded-lg border border-[var(--line)] bg-white
            text-[15px] sm:text-[13px] text-[var(--ink)] sm:w-[150px]
            focus:outline-none focus:border-[var(--accent)]">
          <option value="all">All stages</option>
          {['new', 'contacted', 'interested', 'follow_up', 'ready_to_join', 'registered', 'not_interested', 'lost'].map(x => (
            <option key={x} value={x}>{describeStatus('lead', x).label}</option>
          ))}
        </select>
      </div>

      <Card className="overflow-hidden">
        {loading ? <Spinner /> : filtered.length === 0 ? (
          <div className="py-16">
            <EmptyState  title="No leads match" description="Try adjusting your search or filters, or add a new lead." />
          </div>
        ) : (
          <>
          {/* Mobile: tappable lead cards */}
          <div className="sm:hidden divide-y divide-[var(--line-soft)]">
            {filtered.map((l: any) => (
              <Link key={l.id} href={`/admin/leads/${l.id}`} className="block p-4 active:bg-[var(--line-soft)] transition">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-[15px] text-[var(--ink)] truncate">{l.full_name}</div>
                    <div className="text-[13px] text-[var(--ink-soft)]">{displayPhone(l.phone) || '—'}</div>
                  </div>
                  <Badge tone={STATUS_TONE[l.status] || 'neutral'}>{l.status.replace(/_/g, ' ')}</Badge>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge tone="neutral">{l.source}</Badge>
                  {l.course_interest && <span className="text-[12px] text-[var(--ink-soft)] truncate">{l.course_interest}</span>}
                  <span className="text-[12px] text-[var(--ink-faint)] ml-auto">{l.assignee?.full_name || <span className="text-[var(--warn)] font-medium">Unassigned</span>}</span>
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  {['Name', 'Phone', 'Source', 'Course', 'Stage', 'Owner', 'Added'].map(h => (
                    <th key={h} className="text-left text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((l: any) => (
                  <tr key={l.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--line-soft)] transition">
                    <td className="px-4 py-3">
                      <Link href={`/admin/leads/${l.id}`} className="font-medium text-sm text-[var(--ink)] hover:text-[var(--accent)] transition">{l.full_name}</Link>
                      {l.email && <div className="text-xs text-[var(--ink-faint)]">{l.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--ink-soft)]">{displayPhone(l.phone) || '—'}</td>
                    <td className="px-4 py-3"><Badge tone="neutral">{l.source}</Badge></td>
                    <td className="px-4 py-3 text-sm text-[var(--ink-soft)] max-w-32 truncate">{l.course_interest || '—'}</td>
                    <td className="px-4 py-3"><Badge tone={STATUS_TONE[l.status] || 'neutral'}>{l.status.replace(/_/g, ' ')}</Badge></td>
                    <td className="px-4 py-3 text-sm">{l.assignee?.full_name || <span className="text-[var(--warn)] text-xs font-medium">Unassigned</span>}</td>
                    <td className="px-4 py-3 text-xs text-[var(--ink-faint)]">{formatDateTime(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
    </div>
  )
}

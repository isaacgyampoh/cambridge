'use client'
import { useState } from 'react'
import { displayPhone } from '@/lib/ui/contact'
import { useData } from '@/hooks/useData'
import type { Lead } from '@/types'

/**
 * A lead as this screen selects it: the record plus the two names joined in.
 *
 * The rows were handled as `any` throughout, which is how `next_follow_up` —
 * a column that does not exist — was read and written here without anything
 * objecting. Naming the shape makes the compiler check the field names again.
 */
type LeadRow = Lead & {
  assignee?: { full_name: string } | null
  assigner?: { full_name: string } | null
}
import { formatDateTime } from '@/lib/utils'
import Link from 'next/link'
import {
  PageHeader, Card, Button, Badge, Spinner, EmptyState, Search, ActionMenu,
  Tabs, MobileList, ListRow, Avatar,
} from '@/components/ui'
import { telHref, whatsappHref } from '@/lib/ui/contact'
import { Phone, MessageCircle } from 'lucide-react'
import { describeStatus } from '@/lib/ui/status'

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'muted'
import { exportToExcel } from '@/lib/utils/export'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/useConfirm'

/*
 * The stages people actually sort leads by, as tabs.
 *
 * A select holding eight stages hides the shape of the pipeline: you cannot
 * see that forty leads are sitting at "new" without opening it and reading.
 * Four tabs carrying live counts put that on the screen, and the long tail
 * stays in the stage filter beside them for the rarer cases.
 *
 * 'follow_up' groups with 'interested' because that is one conversation to
 * the person doing the work, not two.
 */
const SEGMENTS: Array<{ key: string; label: string; match: (status: string) => boolean }> = [
  { key: 'all',       label: 'All',        match: () => true },
  { key: 'new',       label: 'New',        match: s => s === 'new' },
  { key: 'contacted', label: 'Contacted',  match: s => s === 'contacted' },
  { key: 'follow_up', label: 'Follow-up',  match: s => s === 'follow_up' || s === 'interested' },
]

const STATUS_TONE: Record<string, BadgeTone> = {
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
  const { data: leads, loading, refetch } = useData<LeadRow>({
    table: 'leads',
    select: '*, assignee:assigned_to(full_name), assigner:assigned_by(full_name)',
    orderBy: 'created_at', orderAsc: false, limit: 500,
  })
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [segment, setSegment] = useState('all')

  /*
   * Search and the two selects narrow the pool; the segment then splits it.
   * Counting on the pre-segment set is what lets each tab show how many leads
   * it holds — counting after would make every tab show its own total.
   */
  const pool = leads.filter((l: LeadRow) => {
    const matchSearch = !search || [l.full_name, l.email, l.phone, l.course_interest].some(v => v?.toLowerCase().includes(search.toLowerCase()))
    const matchSource = sourceFilter === 'all' || l.source === sourceFilter
    const matchStatus = statusFilter === 'all' || l.status === statusFilter
    return matchSearch && matchSource && matchStatus
  })

  const segments = SEGMENTS.map(seg => ({
    key: seg.key,
    label: seg.label,
    count: pool.filter((l: LeadRow) => seg.match(l.status)).length,
  }))

  const activeSegment = SEGMENTS.find(s => s.key === segment) || SEGMENTS[0]
  const filtered = pool.filter((l: LeadRow) => activeSegment.match(l.status))

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
    /*
     * The one irreversible action on this screen, so it asks for the phrase
     * to be typed rather than just clicked.
     *
     * This used window.prompt(). Some mobile webviews refuse to display one
     * at all — and a browser that has been told to block further dialogs
     * returns null silently — so on those devices the button did nothing and
     * said nothing. The dialog is part of the application and cannot be
     * suppressed out from under it.
     */
    if (!await confirm({
      title: 'Delete every lead?',
      confirmLabel: 'Delete all leads',
      requirePhrase: 'DELETE ALL LEADS',
      message: (
        <>
          <p className="mb-3">
            This permanently removes every lead, along with their activity and
            chat history, so you can import a fresh list.
          </p>
          <p className="mb-3">Students, staff and courses are not affected.</p>
          <p className="font-medium text-[var(--ink)]">This cannot be undone.</p>
        </>
      ),
    })) return

    toast.loading('Deleting all leads…', { id: 'clr' })
    const d = await fetch('/api/admin/clear-leads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE ALL LEADS' }),
    }).then(r => r.json()).catch(() => ({ error: 'Request failed' }))
    if (d.success) { toast.success(`Deleted ${d.deleted} lead(s). You can import fresh now.`, { id: 'clr' }); refetch() }
    else toast.error(d.error || 'Could not delete leads', { id: 'clr' })
  }

  async function exportExcel() {
    const rows = filtered.map((l: LeadRow) => ({
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
    const rows = filtered.map((l: LeadRow) => [
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
          className="h-12 sm:h-11 px-3 rounded-lg border border-[var(--line)] bg-[var(--paper)]
            text-[15px] sm:text-[13px] text-[var(--ink)] sm:w-[150px]
            focus:outline-none focus:border-[var(--accent)]">
          <option value="all">All sources</option>
          {['facebook', 'google', 'linkedin', 'website', 'referral', 'manual'].map(x => (
            <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          aria-label="Filter by stage"
          className="h-12 sm:h-11 px-3 rounded-lg border border-[var(--line)] bg-[var(--paper)]
            text-[15px] sm:text-[13px] text-[var(--ink)] sm:w-[150px]
            focus:outline-none focus:border-[var(--accent)]">
          <option value="all">All stages</option>
          {['new', 'contacted', 'interested', 'follow_up', 'ready_to_join', 'registered', 'not_interested', 'lost'].map(x => (
            <option key={x} value={x}>{describeStatus('lead', x).label}</option>
          ))}
        </select>
      </div>

      <Tabs
        tabs={segments}
        active={segment}
        onChange={setSegment}
        label="Lead stages"
        className="mb-4"
      />

      {loading ? (
        <Card className="overflow-hidden"><Spinner /></Card>
      ) : filtered.length === 0 ? (
        <Card className="overflow-hidden">
          <div className="py-16">
            <EmptyState title="No leads match" description="Try adjusting your search or filters, or add a new lead." />
          </div>
        </Card>
      ) : (
        <>
          {/*
            Mobile: the same row this product uses everywhere.

            Previously a bespoke card built from two Badges and three text
            sizes — a fourth spelling of "a person in a list" alongside the
            ones on admissions, students and follow-ups. ListRow is that
            pattern, so the leads list now looks like the rest of the app
            rather than like its own small application.

            Call and WhatsApp are on the row itself. Ringing a lead was three
            taps and a scroll; it is now one, which is the whole job of this
            screen.
          */}
          <div className="sm:hidden">
            <MobileList
              rows={filtered}
              rowKey={(l: LeadRow) => l.id}
              emptyTitle="No leads match"
              emptyMessage="Try a different stage, or adjust your search."
              renderRow={(l: LeadRow) => {
                const tel = telHref(l.phone)
                const wa = whatsappHref(l.phone)
                return (
                  <ListRow
                    href={`/admin/leads/${l.id}`}
                    leading={<Avatar name={l.full_name || ''} size="md" />}
                    title={l.full_name}
                    subtitle={displayPhone(l.phone) || 'No phone number'}
                    status={
                      <Badge tone={STATUS_TONE[l.status] || 'neutral'}>
                        {l.status.replace(/_/g, ' ')}
                      </Badge>
                    }
                    meta={
                      <>
                        <span>{l.source}</span>
                        {l.course_interest && <span className="truncate">{l.course_interest}</span>}
                        <span className={l.assignee?.full_name ? '' : 'text-[var(--warn)] font-medium'}>
                          {l.assignee?.full_name || 'Unassigned'}
                        </span>
                      </>
                    }
                    actions={tel && wa ? (
                      <>
                        <a href={tel} aria-label={`Call ${l.full_name}`}
                          onClick={e => e.stopPropagation()}
                          className="w-10 h-10 grid place-items-center rounded-full
                            bg-[var(--brand-soft)] text-[var(--brand)]
                            active:bg-[var(--brand-line)] transition-colors">
                          <Phone size={16} aria-hidden="true" />
                        </a>
                        <a href={wa} target="_blank" rel="noopener noreferrer"
                          aria-label={`Message ${l.full_name} on WhatsApp`}
                          onClick={e => e.stopPropagation()}
                          className="w-10 h-10 grid place-items-center rounded-full
                            bg-[var(--brand-soft)] text-[var(--brand)]
                            active:bg-[var(--brand-line)] transition-colors">
                          <MessageCircle size={16} aria-hidden="true" />
                        </a>
                      </>
                    ) : undefined}
                  />
                )
              }}
            />
          </div>

          {/* Desktop: a table, inside the one card it belongs in. */}
          <Card className="hidden sm:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  {['Name', 'Phone', 'Source', 'Course', 'Stage', 'Owner', 'Added'].map(h => (
                    <th key={h} className="text-left text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((l: LeadRow) => (
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
          </Card>
        </>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback, use } from 'react'
import Link from 'next/link'
import {
  PageHeader, Card, Button, Badge, Tabs, MobileList, ListRow, StatusBadge,
  ErrorState, LoadingState, SectionHeader,
} from '@/components/ui'
import { displayPhone } from '@/lib/ui/contact'

/**
 * One import, row by row.
 *
 * ── WHY THIS SCREEN EXISTS ─────────────────────────────────────────────────
 *
 * Migration 0011 records an outcome and a reason for every row of every
 * import, precisely so that "480 assigned of 500" can be traced to the twenty
 * rows behind it. Nothing surfaced any of it: the administrator saw totals and
 * had no way to find out which people were missing or why — which is the same
 * position they were in before the import was rebuilt, only with more
 * accurate numbers.
 *
 * A count nobody can open is a count nobody can act on. Every figure at the
 * top of this page is a filter, and every row says in plain words what
 * happened to it.
 */

type Row = {
  id: string
  rowNumber: number
  leadId: string | null
  outcome: string
  reason: string
  name: string
  phone: string | null
}

type ImportRecord = {
  reference: string
  filename: string | null
  status: string
  total_received: number
  valid: number
  invalid: number
  duplicates: number
  assigned: number
  unassigned: number
  failed: number
  started_at: string
  finished_at: string | null
  imported_by_name: string | null
}

function when(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function ImportDetail({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = use(params)

  const [record, setRecord] = useState<ImportRecord | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [truncated, setTruncated] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState('all')

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/imports?reference=${encodeURIComponent(reference)}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false as const, error: json.error || 'Could not load that import.' }
      return { ok: true as const, json }
    } catch {
      return { ok: false as const, error: 'Could not reach the server. Check your connection.' }
    }
  }, [reference])

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchDetail>>) => {
    if (!result.ok) { setError(result.error); setState('error'); return }
    setRecord(result.json.import)
    setRows(result.json.rows || [])
    setTruncated(Boolean(result.json.truncated))
    setError(null)
    setState('ready')
  }, [])

  const reload = useCallback(async () => {
    setState('loading')
    apply(await fetchDetail())
  }, [apply, fetchDetail])

  useEffect(() => {
    let alive = true
    fetchDetail().then(r => { if (alive) apply(r) })
    return () => { alive = false }
  }, [apply, fetchDetail])

  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] || 0) + 1
    return acc
  }, {})

  const shown = tab === 'all' ? rows : rows.filter(r => r.outcome === tab)

  // Ordered so the rows that need attention come first.
  const ORDER = ['failed', 'invalid', 'unassigned', 'duplicate', 'assigned']
  const tabs = [
    { key: 'all', label: 'All rows', count: rows.length },
    ...ORDER.filter(o => counts[o]).map(o => ({
      key: o,
      label: ({
        failed: 'Failed', invalid: 'Invalid', unassigned: 'Unassigned',
        duplicate: 'Duplicates', assigned: 'Assigned',
      })[o] || o,
      count: counts[o],
    })),
  ]

  if (state === 'loading') {
    return <LoadingState message={`Loading ${reference}…`} />
  }

  if (state === 'error' || !record) {
    return (
      <div className="w-full max-w-3xl">
        <ErrorState
          title="Could not load that import"
          message={error || 'Something went wrong on our side.'}
          onRetry={reload}
        />
        <div className="mt-4">
          <Button variant="secondary" href="/admin/leads/import">Back to import</Button>
        </div>
      </div>
    )
  }

  const needsAttention = record.failed + record.unassigned + record.invalid

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Import"
        title={record.reference}
        description={
          record.filename
            ? `${record.filename} · imported by ${record.imported_by_name || 'someone'}`
            : `Imported by ${record.imported_by_name || 'someone'}`
        }
        actions={<Button variant="secondary" href="/admin/leads/import">New import</Button>}
      />

      {/* ── the summary, which is also the filter ───────────────────────── */}
      <Card className="p-4 sm:p-5 mb-5">
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <span className="text-[14px] text-[var(--ink-soft)]">
            <strong className="font-semibold text-[var(--ink)] text-[15px]">
              {record.total_received}
            </strong>{' '}
            {record.total_received === 1 ? 'row' : 'rows'} received
          </span>
          <Badge tone={record.status === 'complete' ? 'success' : 'warning'}>
            {record.status === 'complete' ? 'Complete' : 'Finished with problems'}
          </Badge>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Assigned', value: record.assigned, tone: 'text-[var(--ok)]' },
            { label: 'Duplicates', value: record.duplicates, tone: 'text-[var(--ink-soft)]' },
            { label: 'Invalid', value: record.invalid, tone: 'text-[var(--danger)]' },
            { label: 'Unassigned', value: record.unassigned, tone: 'text-[var(--warn)]' },
            { label: 'Failed', value: record.failed, tone: 'text-[var(--danger)]' },
          ].map(stat => (
            <div key={stat.label}>
              <dd className={`font-display text-[24px] leading-none font-semibold tabular-nums ${stat.tone}`}>
                {stat.value}
              </dd>
              <dt className="text-[12px] text-[var(--ink-soft)] mt-1">{stat.label}</dt>
            </div>
          ))}
        </dl>

        <div className="mt-4 pt-3.5 border-t border-[var(--line-soft)] grid grid-cols-1 sm:grid-cols-2
          gap-x-4 gap-y-1.5 text-[12px] text-[var(--ink-faint)]">
          <span>Started {when(record.started_at)}</span>
          <span>Finished {when(record.finished_at)}</span>
        </div>
      </Card>

      {needsAttention > 0 && (
        <Card className="p-4 mb-5 border-[var(--warn)]/30 bg-[var(--warn-soft)]">
          <p className="text-[14px] text-[var(--ink)] leading-snug">
            <strong className="font-semibold">{needsAttention}</strong>{' '}
            {needsAttention === 1 ? 'row did' : 'rows did'} not result in an assigned lead.
            Each one below says why.
          </p>
        </Card>
      )}

      <SectionHeader title="Rows" count={rows.length} />

      {truncated && (
        <p className="text-[12px] text-[var(--ink-faint)] mb-3">
          Showing the first 500 rows of this import.
        </p>
      )}

      <div className="mb-4">
        <Tabs tabs={tabs} active={tab} onChange={setTab} label="Filter rows by outcome" />
      </div>

      <MobileList
        rows={shown}
        rowKey={row => row.id}
        emptyTitle="No rows with that outcome"
        emptyMessage="Try a different filter."
        renderRow={row => (
          <ListRow
            title={row.name}
            subtitle={
              <>
                <span className="block">{row.phone ? displayPhone(row.phone) : 'No phone number'}</span>
                {/* Why this row ended where it did, in words the administrator
                    can act on rather than a database message. */}
                <span className="block text-[var(--ink)] mt-1 leading-snug">{row.reason}</span>
              </>
            }
            status={<StatusBadge domain="importRow" value={row.outcome} />}
            meta={
              <>
                <span>Row {row.rowNumber}</span>
                {row.leadId && (
                  <Link href={`/admin/leads/${row.leadId}`}
                    className="text-[var(--accent)] font-semibold hover:underline">
                    Open lead
                  </Link>
                )}
              </>
            }
          />
        )}
      />
    </div>
  )
}

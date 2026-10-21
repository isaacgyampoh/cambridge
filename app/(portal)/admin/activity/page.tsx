'use client'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, inputClass } from '@/components/ui'

/**
 * Who did what, and when.
 *
 * recordAudit() has been writing to audit_logs since September — eight
 * hundred entries across thirty-two kinds of action — and nothing ever read
 * them. A trail nobody can see is worse than no trail, because everybody
 * believes there is a record.
 */

type Entry = {
  id: string; at: string; action: string; resource: string | null
  recordId: string | null; actor: string; actorRole: string | null; ip: string | null
}

/** Action names are machine-shaped; this is how a person reads them. */
function phrase(action: string): string {
  const [subject, verb] = action.split('.')
  const words = (s: string) => s.replace(/_/g, ' ')
  return verb ? `${words(verb)} — ${words(subject)}` : words(action)
}

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default function ActivityLog() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [actions, setActions] = useState<string[]>([])
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [problem, setProblem] = useState('')

  const load = useCallback(async () => {
    setState('loading')
    try {
      const qs = new URLSearchParams({ page: String(page) })
      if (action) qs.set('action', action)
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const res = await fetch(`/api/activity-log?${qs}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setProblem(d.error || 'The activity log could not be read.'); setState('error'); return }
      setEntries(d.entries || [])
      setTotal(d.total || 0)
      setState('ready')
    } catch {
      setProblem('The activity log could not be reached.')
      setState('error')
    }
  }, [page, action, from, to])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/activity-log', { method: 'POST' })
      .then(r => r.ok ? r.json() : { actions: [] })
      .then(d => setActions(d.actions || []))
      .catch(() => {})
  }, [])

  const pages = Math.ceil(total / 50)

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader eyebrow="Oversight" title="Activity log"
        description="Every recorded action across the portal — who did it, to what, and when." />

      <Card className="p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[12px] font-medium text-[var(--ink-soft)] mb-1.5">Action</label>
            <select className={inputClass} value={action}
              onChange={e => { setAction(e.target.value); setPage(0) }} aria-label="Filter by action">
              <option value="">Everything</option>
              {actions.map(a => <option key={a} value={a}>{phrase(a)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[var(--ink-soft)] mb-1.5">From</label>
            <input type="date" className={inputClass} value={from}
              onChange={e => { setFrom(e.target.value); setPage(0) }} aria-label="From date" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[var(--ink-soft)] mb-1.5">To</label>
            <input type="date" className={inputClass} value={to}
              onChange={e => { setTo(e.target.value); setPage(0) }} aria-label="To date" />
          </div>
        </div>
      </Card>

      {state === 'loading' ? <Spinner />
        : state === 'error' ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-[var(--danger)]">{problem}</p>
          </Card>
        ) : entries.length === 0 ? (
          <EmptyState title="Nothing recorded" description={
            action || from || to
              ? 'No activity matches those filters. Widen the dates or choose Everything.'
              : 'No activity has been recorded yet.'
          } />
        ) : (
          <>
            <p className="text-[12px] text-[var(--ink-faint)] mb-3">
              {total.toLocaleString()} entr{total === 1 ? 'y' : 'ies'}
              {pages > 1 ? ` · page ${page + 1} of ${pages}` : ''}
            </p>
            <div className="space-y-2">
              {entries.map(e => (
                <Card key={e.id} className="p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[14px] text-[var(--ink)] font-medium truncate">{phrase(e.action)}</div>
                      <div className="text-[12px] text-[var(--ink-soft)] mt-0.5 truncate">
                        {e.actor}{e.actorRole ? ` · ${e.actorRole.replace(/_/g, ' ')}` : ''}
                        {e.resource ? ` · ${e.resource}` : ''}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[12px] text-[var(--ink-faint)]">{when(e.at)}</div>
                      {/* A failed action is the one worth noticing. */}
                      {e.action.includes('denied') || e.action.includes('refused') ? (
                        <Badge tone="danger">refused</Badge>
                      ) : null}
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {pages > 1 && (
              <div className="flex items-center justify-between gap-3 mt-5">
                <Button variant="secondary" disabled={page === 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}>Newer</Button>
                <span className="text-[12px] text-[var(--ink-faint)]">page {page + 1} of {pages}</span>
                <Button variant="secondary" disabled={page + 1 >= pages}
                  onClick={() => setPage(p => p + 1)}>Older</Button>
              </div>
            )}
          </>
        )}
    </div>
  )
}

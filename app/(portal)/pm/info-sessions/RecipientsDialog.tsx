'use client'
import { useCallback, useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/overlays'
import { Button, Badge, EmptyState } from '@/components/ui'
import { displayPhone } from '@/lib/ui/contact'
import { formatDateTime } from '@/lib/utils'

/**
 * EXACTLY WHO A CAMPAIGN WENT TO, AND WHAT EACH OF THEM WAS SENT.
 *
 * Clicking "250 recipients" opens those two hundred and fifty records — the
 * people this campaign enrolled, the text each one received and what became
 * of it. A filtered list of all leads would answer a different question, and
 * would answer it differently tomorrow.
 */

type Recipient = {
  id: string; leadId: string; name: string; phone: string | null
  leadStatus: string | null; source: string | null; course: string | null
  status: string; channel: string | null; attempts: number
  reason: string | null; sentAt: string | null; message: string | null
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  sent: 'success', claimed: 'warning', pending: 'neutral',
  failed: 'danger', unreachable: 'warning',
}

/** What each state means to somebody who does not work on this system. */
const STATUS_LABEL: Record<string, string> = {
  sent: 'Submitted',
  claimed: 'Processing',
  pending: 'Waiting',
  failed: 'Failed',
  unreachable: 'No usable number',
}

export function RecipientsDialog({
  sessionId, title, status, onClose,
}: {
  sessionId: string | null
  title: string
  /** Opened from a particular figure, so it opens on those records. */
  status?: string | null
  onClose: () => void
}) {
  const [rows, setRows] = useState<Recipient[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [reading, setReading] = useState<Recipient | null>(null)

  const load = useCallback(async () => {
    if (!sessionId) return
    setState('loading')
    try {
      const params = new URLSearchParams({ session: sessionId, page: String(page) })
      if (status) params.set('status', status)
      if (query.trim()) params.set('q', query.trim())
      const d = await fetch(`/api/info-sessions/recipients?${params}`).then(r => r.json())
      if (!d.success) throw new Error(d.error || 'The recipients could not be loaded.')
      setRows(d.recipients || [])
      setTotal(d.total || 0)
      setState('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The recipients could not be loaded.')
      setState('error')
    }
  }, [sessionId, page, status, query])

  useEffect(() => { if (sessionId) load() }, [sessionId, load])
  useEffect(() => { setPage(0) }, [status, sessionId])

  const pages = Math.ceil(total / 100)

  return (
    <Dialog
      open={Boolean(sessionId)}
      onClose={onClose}
      size="lg"
      title={reading ? 'The message this person was sent' : `Recipients — ${title}`}
      description={reading
        ? `${reading.name}${reading.phone ? ` · ${displayPhone(reading.phone)}` : ''}`
        : status
          ? `${total} ${(STATUS_LABEL[status] || status).toLowerCase()}`
          : `${total} ${total === 1 ? 'person' : 'people'} this campaign enrolled`}
      footer={
        reading
          ? <Button variant="secondary" onClick={() => setReading(null)}>Back to the list</Button>
          : <Button variant="secondary" onClick={onClose}>Close</Button>
      }
    >
      {reading ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--canvas)] p-3">
            <p className="text-[14px] text-[var(--ink)] whitespace-pre-wrap leading-relaxed">
              {reading.message || 'No message was recorded for this recipient.'}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            {[
              ['Status', STATUS_LABEL[reading.status] || reading.status],
              ['Sent by', reading.channel ? reading.channel.replace(/_/g, ' ') : '—'],
              ['Processed', reading.sentAt ? formatDateTime(reading.sentAt) : 'Not yet'],
              ['Attempts', String(reading.attempts)],
              ['Lead status', reading.leadStatus?.replace(/_/g, ' ') || '—'],
              ['Course', reading.course || '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-[var(--ink-faint)]">{k}</dt>
                <dd className="font-medium text-[var(--ink)] text-right">{v}</dd>
              </div>
            ))}
          </dl>
          {reading.reason && (
            <p className="text-[13px] text-[var(--danger)]">Reason: {reading.reason}</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-3">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setPage(0); load() } }}
              placeholder="Search by name or phone number"
              className="flex-1 h-10 px-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] text-[14px]"
            />
            <Button size="sm" variant="secondary" onClick={() => { setPage(0); load() }}>Search</Button>
          </div>

          {state === 'loading' && <p className="text-[13px] text-[var(--ink-faint)] py-6 text-center">Loading…</p>}
          {state === 'error' && (
            <div className="py-6 text-center">
              <p className="text-[13px] text-[var(--danger)] mb-2">{error}</p>
              <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
            </div>
          )}
          {state === 'ready' && rows.length === 0 && (
            <EmptyState title="Nothing matches" description="Try a different search, or clear it to see everyone." />
          )}

          {state === 'ready' && rows.length > 0 && (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--ink-faint)] border-b border-[var(--line)]">
                    <th className="px-2 py-2 font-semibold">Name</th>
                    <th className="px-2 py-2 font-semibold">Phone</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Processed</th>
                    <th className="px-2 py-2 font-semibold">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-b border-[var(--line-soft)] last:border-0">
                      <td className="px-2 py-2">
                        <div className="font-medium text-[var(--ink)]">{r.name}</div>
                        <div className="text-[11px] text-[var(--ink-faint)] font-mono">{r.leadId.slice(0, 8)}</div>
                      </td>
                      <td className="px-2 py-2 text-[var(--ink-soft)] tabular-nums">{displayPhone(r.phone)}</td>
                      <td className="px-2 py-2">
                        <Badge tone={STATUS_TONE[r.status] || 'neutral'}>{STATUS_LABEL[r.status] || r.status}</Badge>
                        {r.reason && <div className="text-[11px] text-[var(--ink-faint)] mt-0.5 max-w-[14rem]">{r.reason}</div>}
                      </td>
                      <td className="px-2 py-2 text-[12px] text-[var(--ink-faint)]">
                        {r.sentAt ? formatDateTime(r.sentAt) : '—'}
                      </td>
                      <td className="px-2 py-2">
                        <button onClick={() => setReading(r)}
                          className="text-[13px] text-[var(--accent)] hover:underline">
                          Read it
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-[var(--line-soft)]">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <span className="text-[12px] text-[var(--ink-faint)]">Page {page + 1} of {pages}</span>
              <Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </Dialog>
  )
}

'use client'
import { useState, useEffect, useCallback } from 'react'
import { PageHeader, Card, Badge, StatCard, Button, inputClass } from '@/components/ui'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ErrorState } from '@/components/ui/states'

/**
 * SMS delivery.
 *
 * ── WHY THIS SCREEN EXISTS ─────────────────────────────────────────────────
 *
 * The question nobody could answer was "why didn't this member of staff get
 * their SMS?". The evidence was in the database the whole time — 438
 * delivered, 27 failed, 22 of those a provider timeout — but no screen showed
 * it, so the failures were only discovered by querying Postgres directly
 * during an audit. A delivery problem nobody can see is indistinguishable
 * from no problem at all, which is exactly how twenty-two staff notifications
 * went missing without anyone noticing.
 *
 * So the page is built around the question rather than around the table:
 * type in a phone number, get every message ever addressed to it and a plain
 * sentence saying what happened to each one.
 */

type Message = {
  id: string
  recipient: string
  kind: string | null
  status: string
  attempts: number
  max_attempts: number
  provider_message_id: string | null
  last_error: string | null
  created_at: string
  sent_at: string | null
  next_retry_at: string | null
  message: string
  diagnosis: string
}

type Health = { queued: number; retrying: number; failed24h: number; sent24h: number }

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'accent'> = {
  sent: 'success', queued: 'neutral', sending: 'accent', retrying: 'warning', failed: 'danger',
}

const LABEL: Record<string, string> = {
  sent: 'Delivered', queued: 'Waiting', sending: 'In flight',
  retrying: 'Retrying', failed: 'Given up',
}

/** Local display of a phone number: 233201234567 reads as 0201234567 here. */
function local(num: string): string {
  return num?.replace(/^233/, '0') || num
}

function when(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default function SmsDeliveryPage() {
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  /**
   * Fetch, without touching React state.
   *
   * Kept separate so the mount effect can apply its result AFTER the await
   * rather than setting state synchronously in the effect body, which
   * cascades a render on every mount.
   */
  const fetchDelivery = useCallback(async (
    opts: { phone?: string; status?: string } = {}
  ): Promise<{ ok: true; messages: Message[]; health: Health | null } | { ok: false; error: string }> => {
    try {
      const params = new URLSearchParams()
      if (opts.phone) params.set('phone', opts.phone)
      if (opts.status) params.set('status', opts.status)

      const res = await fetch(`/api/sms/delivery?${params}`)
      const json = await res.json().catch(() => ({}))

      // Said out loud, not swallowed into an empty table. An empty list
      // because a search was refused must not look like an empty list
      // because nothing was ever sent.
      if (!res.ok) return { ok: false, error: json.error || 'Could not read the delivery log.' }

      return { ok: true, messages: json.messages || [], health: json.health || null }
    } catch {
      return { ok: false, error: 'Could not reach the server. Check your connection and try again.' }
    }
  }, [])

  const apply = useCallback((
    result: Awaited<ReturnType<typeof fetchDelivery>>
  ) => {
    if (!result.ok) { setError(result.error); setState('error'); return }
    setMessages(result.messages)
    setHealth(result.health)
    setError(null)
    setState('ready')
  }, [])

  /** A user-initiated load: show the spinner, then apply. */
  const load = useCallback(async (opts: { phone?: string; status?: string } = {}) => {
    setState('loading')
    setError(null)
    apply(await fetchDelivery(opts))
  }, [apply, fetchDelivery])

  // The first load. State is already 'loading' from useState, so nothing is
  // set until the response arrives — and a result that lands after the user
  // has navigated away is discarded rather than written to a dead component.
  useEffect(() => {
    let alive = true
    fetchDelivery().then(result => { if (alive) apply(result) })
    return () => { alive = false }
  }, [apply, fetchDelivery])

  const search = () => load({ phone: phone.trim(), status })
  const clear = () => { setPhone(''); setStatus(''); load() }

  const columns: Column<Message>[] = [
    {
      key: 'recipient', header: 'To', primary: true,
      render: r => <span className="font-medium tabular-nums">{local(r.recipient)}</span>,
    },
    {
      key: 'kind', header: 'Message', secondary: true,
      render: r => (
        <span className="text-[var(--ink-soft)]">
          {r.kind ? r.kind.replace(/_/g, ' ') : 'unclassified'}
        </span>
      ),
    },
    {
      key: 'status', header: 'Outcome',
      render: r => <Badge tone={TONE[r.status] || 'neutral'}>{LABEL[r.status] || r.status}</Badge>,
    },
    {
      key: 'attempts', header: 'Tries', numeric: true, hideOnMobile: true,
      render: r => <span className="tabular-nums">{r.attempts}/{r.max_attempts}</span>,
    },
    {
      key: 'created_at', header: 'Queued', hideOnMobile: true,
      render: r => <span className="text-[var(--ink-soft)] tabular-nums">{when(r.created_at)}</span>,
    },
  ]

  return (
    <div className="fade-in w-full max-w-5xl">
      <PageHeader
        eyebrow="Diagnostics"
        title="SMS delivery"
        description="Every text the system has tried to send, and what became of it. If somebody says they never got their message, put their number in here."
        actions={<Button variant="secondary" size="sm" onClick={() => load({ phone, status })}>Refresh</Button>}
      />

      {health && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
          <StatCard label="Delivered (24h)" value={health.sent24h} />
          <StatCard label="Given up (24h)" value={health.failed24h}
            sub={health.failed24h > 0 ? 'These people were never reached' : 'Nothing lost'} />
          <StatCard label="Waiting" value={health.queued} sub="Not yet attempted" />
          <StatCard label="Retrying" value={health.retrying} sub="Failed once, trying again" />
        </div>
      )}

      <Card className="p-4 mb-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label htmlFor="sms-phone" className="block text-[12.5px] font-medium text-[var(--ink-soft)] mb-1.5">
              Phone number
            </label>
            <input
              id="sms-phone"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') search() }}
              placeholder="0201234567"
              inputMode="tel"
              autoComplete="tel"
              className={inputClass}
            />
          </div>
          <div className="sm:w-48">
            <label htmlFor="sms-status" className="block text-[12.5px] font-medium text-[var(--ink-soft)] mb-1.5">
              Outcome
            </label>
            <select id="sms-status" value={status} onChange={e => setStatus(e.target.value)} className={inputClass}>
              <option value="">Any</option>
              <option value="failed">Given up</option>
              <option value="retrying">Retrying</option>
              <option value="queued">Waiting</option>
              <option value="sending">In flight</option>
              <option value="sent">Delivered</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={search}>Search</Button>
            {(phone || status) && <Button variant="ghost" onClick={clear}>Clear</Button>}
          </div>
        </div>
      </Card>

      {state === 'error' ? (
        <ErrorState message={error || 'Something went wrong.'} onRetry={() => load({ phone, status })} />
      ) : (
        <>
          <DataTable
            caption="SMS delivery attempts"
            columns={columns}
            rows={messages}
            rowKey={r => r.id}
            state={state}
            onRetry={() => load({ phone, status })}
            onRowClick={r => setOpen(open === r.id ? null : r.id)}
            emptyTitle={phone ? 'No messages to that number' : 'Nothing sent yet'}
            emptyMessage={phone
              ? 'The system has never tried to text this number. If they were expecting something, the message was never queued — the problem is upstream of delivery.'
              : 'No SMS has been queued yet.'}
          />

          {/* The diagnosis, in words, for whoever has to answer for it. */}
          {open && (() => {
            const row = messages.find(m => m.id === open)
            if (!row) return null
            return (
              <Card className="p-5 mt-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="text-[13px] text-[var(--ink-faint)] mb-0.5">
                      {local(row.recipient)} · {row.kind?.replace(/_/g, ' ') || 'unclassified'}
                    </div>
                    <Badge tone={TONE[row.status] || 'neutral'}>{LABEL[row.status] || row.status}</Badge>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>Close</Button>
                </div>

                <p className="text-[14.5px] text-[var(--ink)] leading-relaxed mb-4">{row.diagnosis}</p>

                <div className="rounded-xl bg-[var(--canvas)] border border-[var(--line)] p-3 mb-4">
                  <div className="text-[12px] font-medium text-[var(--ink-faint)] mb-1">The message itself</div>
                  <p className="text-[13.5px] text-[var(--ink-soft)] leading-relaxed whitespace-pre-wrap break-words">
                    {row.message}
                  </p>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-[13px]">
                  <div>
                    <dt className="text-[var(--ink-faint)]">Queued</dt>
                    <dd className="text-[var(--ink)] tabular-nums">{when(row.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--ink-faint)]">Delivered</dt>
                    <dd className="text-[var(--ink)] tabular-nums">{when(row.sent_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--ink-faint)]">Attempts</dt>
                    <dd className="text-[var(--ink)] tabular-nums">{row.attempts} of {row.max_attempts}</dd>
                  </div>
                  {row.next_retry_at && row.status !== 'sent' && (
                    <div>
                      <dt className="text-[var(--ink-faint)]">Next try</dt>
                      <dd className="text-[var(--ink)] tabular-nums">{when(row.next_retry_at)}</dd>
                    </div>
                  )}
                  {row.provider_message_id && (
                    <div className="col-span-2 sm:col-span-3">
                      <dt className="text-[var(--ink-faint)]">Arkesel reference</dt>
                      {/* Quote this to the provider when chasing a message
                          that we handed over but the recipient never saw. */}
                      <dd className="text-[var(--ink)] font-mono text-[12px] break-all">
                        {row.provider_message_id}
                      </dd>
                    </div>
                  )}
                  {row.last_error && (
                    <div className="col-span-2 sm:col-span-3">
                      <dt className="text-[var(--ink-faint)]">What the provider said</dt>
                      <dd className="text-[var(--danger)] break-words">{row.last_error}</dd>
                    </div>
                  )}
                </dl>
              </Card>
            )
          })()}
        </>
      )}
    </div>
  )
}

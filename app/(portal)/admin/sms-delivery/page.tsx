'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  PageHeader, Card, Button, Search, Tabs, StatusBadge,
  MobileList, ListRow, ErrorState, SectionHeader,
} from '@/components/ui'
import { describeStatus } from '@/lib/ui/status'
import { displayPhone } from '@/lib/ui/contact'

/**
 * SMS delivery.
 *
 * ── WHY THIS SCREEN EXISTS ─────────────────────────────────────────────────
 *
 * The question nobody could answer was "why didn't this member of staff
 * receive their SMS?". The evidence was in the database the whole time — 438
 * delivered, 27 failed, 22 of those a provider timeout — but no screen showed
 * it, so the failures were only found by querying Postgres directly during an
 * audit. A delivery problem nobody can see is indistinguishable from no
 * problem at all, which is exactly how twenty-two staff notifications went
 * missing without anyone noticing.
 *
 * So the page is built around the question rather than around the table: put
 * in a phone number, get every message ever addressed to it and a plain
 * sentence saying what happened to each one.
 *
 * Statuses come from lib/ui/status.ts. This screen previously carried its own
 * label and tone maps, which is the drift that module exists to prevent — the
 * same delivery state must not read as "Failed" here and "Given up" in a
 * report.
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

/** The order an administrator cares about: problems first. */
const FILTERS = ['failed', 'retrying', 'queued', 'sending', 'sent'] as const

function when(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default function SmsDeliveryPage() {
  const [phone, setPhone] = useState('')
  const [tab, setTab] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  /**
   * Fetch, without touching React state.
   *
   * Kept separate so the mount effect applies its result AFTER the await
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
      // because a search was refused must not look like an empty list because
      // nothing was ever sent.
      if (!res.ok) return { ok: false, error: json.error || 'Could not read the delivery log.' }

      return { ok: true, messages: json.messages || [], health: json.health || null }
    } catch {
      return { ok: false, error: 'Could not reach the server. Check your connection and try again.' }
    }
  }, [])

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchDelivery>>) => {
    if (!result.ok) { setError(result.error); setState('error'); return }
    setMessages(result.messages)
    setHealth(result.health)
    setError(null)
    setState('ready')
  }, [])

  const load = useCallback(async (opts: { phone?: string; status?: string } = {}) => {
    setState('loading')
    setError(null)
    apply(await fetchDelivery(opts))
  }, [apply, fetchDelivery])

  useEffect(() => {
    let alive = true
    fetchDelivery().then(result => { if (alive) apply(result) })
    return () => { alive = false }
  }, [apply, fetchDelivery])

  const search = () => load({ phone: phone.trim(), status: tab })
  const pickTab = (key: string) => { setTab(key); load({ phone: phone.trim(), status: key }) }
  const clear = () => { setPhone(''); setTab(''); load() }

  const tabs = [
    { key: '', label: 'All' },
    ...FILTERS.map(s => ({ key: s, label: describeStatus('sms', s).label })),
  ]

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Diagnostics"
        title="SMS delivery"
        description="Every text the system has tried to send, and what became of it. If somebody says they never got their message, put their number in here."
        actions={
          <Button variant="secondary" size="sm" onClick={() => load({ phone, status: tab })}>
            Refresh
          </Button>
        }
      />

      {health && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 mb-5">
          {[
            { label: 'Delivered (24h)', value: health.sent24h, sub: 'Handed to the network' },
            { label: 'Given up (24h)', value: health.failed24h,
              sub: health.failed24h > 0 ? 'These people were never reached' : 'Nothing lost',
              tone: health.failed24h > 0 ? 'text-[var(--danger)]' : undefined },
            { label: 'Waiting', value: health.queued, sub: 'Not yet attempted' },
            { label: 'Retrying', value: health.retrying, sub: 'Failed once, trying again',
              tone: health.retrying > 0 ? 'text-[var(--warn)]' : undefined },
          ].map(stat => (
            <Card key={stat.label} className="p-4">
              <div className={`font-display text-[24px] leading-none font-semibold tabular-nums
                ${stat.tone || 'text-[var(--ink)]'}`}>
                {stat.value}
              </div>
              <div className="text-[12px] text-[var(--ink-soft)] mt-1.5">{stat.label}</div>
              <div className="text-[11px] text-[var(--ink-faint)] mt-0.5 leading-snug">{stat.sub}</div>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-3 mb-5">
        <div className="flex gap-2">
          <Search
            value={phone}
            onChange={setPhone}
            onSubmit={search}
            placeholder="0201234567"
            label="Search by phone number"
            className="flex-1"
          />
          <Button onClick={search}>Search</Button>
          {(phone || tab) && <Button variant="ghost" onClick={clear}>Clear</Button>}
        </div>
        <Tabs tabs={tabs} active={tab} onChange={pickTab} label="Filter by delivery outcome" />
      </div>

      {state === 'error' ? (
        <ErrorState
          title="Could not read the delivery log"
          message={error || 'Something went wrong on our side.'}
          onRetry={() => load({ phone, status: tab })}
        />
      ) : (
        <MobileList
          rows={messages}
          rowKey={m => m.id}
          state={state}
          onRetry={() => load({ phone, status: tab })}
          emptyTitle={phone ? 'No messages to that number' : 'Nothing sent yet'}
          emptyMessage={
            phone
              ? 'The system has never tried to text this number. If they were expecting something, the message was never queued — the problem is upstream of delivery.'
              : 'No SMS has been queued yet.'
          }
          renderRow={row => (
            <ListRow
              onClick={() => setOpen(open === row.id ? null : row.id)}
              title={displayPhone(row.recipient)}
              subtitle={
                <>
                  <span className="block">{row.kind ? row.kind.replace(/_/g, ' ') : 'unclassified'}</span>
                  {/* The whole point of the screen: why, in a sentence. */}
                  <span className="block text-[var(--ink)] mt-1 leading-snug">{row.diagnosis}</span>
                </>
              }
              status={<StatusBadge domain="sms" value={row.status} />}
              meta={
                <>
                  <span className="tabular-nums">{row.attempts}/{row.max_attempts} tries</span>
                  <span className="tabular-nums">{when(row.created_at)}</span>
                </>
              }
            />
          )}
        />
      )}

      {/* The full record for one message, opened from its row. */}
      {open && (() => {
        const row = messages.find(m => m.id === open)
        if (!row) return null
        return (
          <Card className="p-5 mt-4">
            <SectionHeader
              title={displayPhone(row.recipient)}
              description={row.kind?.replace(/_/g, ' ') || 'unclassified'}
              action={<Button variant="ghost" size="sm" onClick={() => setOpen(null)}>Close</Button>}
            />

            <div className="mb-4"><StatusBadge domain="sms" value={row.status} /></div>

            <p className="text-[14px] text-[var(--ink)] leading-relaxed mb-4">{row.diagnosis}</p>

            <div className="rounded-2xl bg-[var(--canvas)] border border-[var(--line)] p-3 mb-4">
              <div className="text-[12px] font-medium text-[var(--ink-faint)] mb-1">The message itself</div>
              <p className="text-[13px] text-[var(--ink-soft)] leading-relaxed whitespace-pre-wrap break-words">
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
                  {/* Quote this to the provider when chasing a message we
                      handed over but the recipient never saw. */}
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
    </div>
  )
}

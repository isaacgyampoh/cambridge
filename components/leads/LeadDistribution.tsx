'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState } from '@/components/ui'
import { postJson, messageFor } from '@/lib/api/post'
import { validateAllocations, round2, simulate } from '@/lib/leads/distribution'

/**
 * Lead distribution — the configured shares, and what actually happened.
 *
 * One screen, mounted at two paths so the super admin reaches it under
 * Settings and the project manager reaches it under their own section. The
 * server decides what each of them may do; this renders the same thing for
 * both because they are allowed the same thing.
 *
 * ── LAYOUT ─────────────────────────────────────────────────────────────────
 *
 * A table this wide cannot be made to fit a phone by shrinking it, so it is
 * not a table on a phone. Above `md` it is rows; below, each person is a card
 * carrying the same figures in a stacked order. Nothing scrolls sideways and
 * nothing is hidden behind an overflow the thumb has to find.
 */

type Member = {
  profileId: string
  fullName: string
  role: string
  allocationPercent: number
  isActive: boolean
  leadsReceived: number
  receivedInPeriod: number
  expected: number
  actualShare: number
  variance: number
  lastAssignedAt: string | null
  configured: boolean
}

type Overview = {
  period: string
  members: Member[]
  totalAssigned: number
  unassigned: number
  stranded: number
  strandedHolders: number
  notifyFailures: number
  configuredTotal: number
  unconfigured: boolean
}

type Event = {
  id: string
  leadId: string
  leadName: string | null
  to: string | null
  reason: string | null
  method: string | null
  weight: number | null
  source: string | null
  notified: boolean | null
  notifyError: string | null
  at: string
}

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All time' },
]

const METHOD_LABEL: Record<string, string> = {
  weighted: 'Weighted allocation',
  direct_attribution: 'Direct attribution',
  equal_fallback: 'Equal share (not configured)',
  legacy_least_loaded: 'Previous engine',
  already_assigned: 'Already owned',
  manual: 'Assigned by hand',
  reassign: 'Reassigned',
  auto: 'Automatic',
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  })
}

export default function LeadDistribution({ canEdit = true }: { canEdit?: boolean }) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [events, setEvents] = useState<Event[] | null>(null)
  const [period, setPeriod] = useState('30d')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'allocation' | 'history'>('allocation')

  /** Edits held here until saved, so a half-typed total does not go to the server. */
  const [draft, setDraft] = useState<Record<string, { percent: number; active: boolean }>>({})

  const load = useCallback(async (p: string) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/leads/distribution?period=${p}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load lead distribution.')
      setOverview(body)
      setDraft(Object.fromEntries(body.members.map((m: Member) =>
        [m.profileId, { percent: m.allocationPercent, active: m.isActive }])))
    } catch (e) {
      // A failed read is shown as a failure. It is never rendered as an empty
      // allocation, which would look like a configuration somebody deleted.
      setError(messageFor(e, 'Could not load lead distribution.'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load(period) }, [period, load])

  useEffect(() => {
    if (tab !== 'history' || events) return
    fetch('/api/leads/distribution/history?limit=60')
      .then(r => r.json().then(b => { if (!r.ok) throw new Error(b.error); return b }))
      .then(b => setEvents(b.events))
      .catch(e => toast.error(messageFor(e, 'Could not load the allocation history.')))
  }, [tab, events])

  const rows = overview?.members ?? []

  const issues = useMemo(() => validateAllocations(
    rows.map(m => ({
      id: m.profileId,
      allocationPercent: draft[m.profileId]?.percent ?? m.allocationPercent,
      isActive: draft[m.profileId]?.active ?? m.isActive,
    })),
  ), [rows, draft])

  const activeTotal = useMemo(() => round2(rows.reduce((s, m) => {
    const d = draft[m.profileId]
    return s + ((d?.active ?? m.isActive) ? (d?.percent ?? m.allocationPercent) : 0)
  }, 0)), [rows, draft])

  const dirty = useMemo(() => rows.some(m => {
    const d = draft[m.profileId]
    return d && (d.percent !== m.allocationPercent || d.active !== m.isActive)
  }), [rows, draft])

  /*
   * What the shares will actually produce, shown before anything is saved.
   * The requirement is that the system never silently normalises — so rather
   * than adjusting the numbers behind the manager, it runs the real scheduler
   * over the next twenty leads and shows the result.
   */
  const preview = useMemo(() => {
    const members = rows
      .filter(m => (draft[m.profileId]?.active ?? m.isActive))
      .map(m => ({
        id: m.profileId,
        allocationPercent: draft[m.profileId]?.percent ?? m.allocationPercent,
        currentWeight: 0,
      }))
    if (!members.length) return null
    return simulate(members, 20)
  }, [rows, draft])

  async function save() {
    if (issues.length) { toast.error(issues[0].message); return }
    setSaving(true)
    try {
      await postJson('/api/leads/distribution', {
        rows: rows.map(m => ({
          profileId: m.profileId,
          allocationPercent: draft[m.profileId]?.percent ?? m.allocationPercent,
          isActive: draft[m.profileId]?.active ?? m.isActive,
        })),
      })
      toast.success('Lead distribution updated')
      await load(period)
    } catch (e) {
      toast.error(messageFor(e, 'Could not save the allocation.'))
    } finally { setSaving(false) }
  }

  function set(id: string, patch: Partial<{ percent: number; active: boolean }>) {
    setDraft(d => ({ ...d, [id]: { ...d[id], ...patch } as { percent: number; active: boolean } }))
  }

  if (loading && !overview) {
    return <div className="flex justify-center py-20"><Spinner /></div>
  }

  if (error) {
    return (
      <div className="fade-in w-full max-w-5xl mx-auto">
        <PageHeader eyebrow="Growth" title="Lead distribution" />
        <Card>
          <p className="text-sm text-[var(--danger)]">{error}</p>
          <Button className="mt-4" onClick={() => load(period)}>Try again</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="fade-in w-full max-w-5xl mx-auto pb-24">
      <PageHeader
        eyebrow="Growth"
        title="Lead distribution"
        description="How shared leads are split between the people who work them."
      />

      {/* ── Anything the operator must know before reading the numbers ────── */}
      {/*
        * The state that assigned nothing: everybody who can receive leads is
        * switched Off. Said at the top, in the saved settings' own terms, so it
        * is seen here rather than discovered through a lead that went nowhere.
        */}
      {overview && overview.members.length > 0 && overview.members.every(m => !m.isActive) && (
        <Card className="mb-4 !bg-[var(--attention-soft)] border-[var(--attention)]">
          <p className="text-sm font-semibold text-[var(--ink)]">Everybody is switched Off — no lead can be assigned</p>
          <p className="text-sm text-[var(--ink-soft)] mt-1">
            All {overview.members.length} people below are set to Off, so new and waiting leads have nobody to go to.
            Switch On the people who should receive leads, give them percentages that add up to 100%, and save.
          </p>
        </Card>
      )}

      {overview && overview.unconfigured && (
        <Card className="mb-4 !bg-[var(--attention-soft)] border-[var(--attention)]">
          <p className="text-sm font-semibold text-[var(--ink)]">No shares configured</p>
          <p className="text-sm text-[var(--ink-soft)] mt-1">
            Every eligible person is on 0%, so leads are being shared equally in rotation.
            Set the percentages below and save to put the configured split in force.
          </p>
        </Card>
      )}

      {overview && overview.stranded > 0 && (
        <Card className="mb-4 !bg-[var(--attention-soft)] border-[var(--attention)]">
          <p className="text-sm font-semibold text-[var(--ink)]">
            {overview.stranded} lead{overview.stranded === 1 ? '' : 's'} held by {overview.strandedHolders}{' '}
            {overview.strandedHolders === 1 ? 'person who is' : 'people who are'} no longer eligible
          </p>
          <p className="text-sm text-[var(--ink-soft)] mt-1">
            These are assigned and recorded, but the person holding them has no leads page — which is what
            &ldquo;the lead disappeared&rdquo; looks like from the outside. They are not touched automatically.
            Reassign them from the Lead inbox.
          </p>
        </Card>
      )}

      {/* ── Headline figures ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Figure label="Distributed" value={overview?.totalAssigned ?? 0} bright />
        <Figure label="Unassigned" value={overview?.unassigned ?? 0}
                tone={(overview?.unassigned ?? 0) > 0 ? 'attention' : undefined} />
        <Figure label="Active share" value={`${activeTotal}%`}
                tone={Math.abs(activeTotal - 100) > 0.01 ? 'attention' : undefined} />
        <Figure label="Notify failures" value={overview?.notifyFailures ?? 0}
                tone={(overview?.notifyFailures ?? 0) > 0 ? 'attention' : undefined} />
      </div>

      {/* ── Tabs + period ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1 p-1 rounded-full bg-[var(--line-soft)]">
          {(['allocation', 'history'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 h-11 sm:h-9 rounded-full text-[13px] font-medium transition-colors ${
                tab === t ? 'bg-[var(--ink)] text-[var(--paper)]' : 'text-[var(--ink-soft)]'}`}>
              {t === 'allocation' ? 'Allocation' : 'History'}
            </button>
          ))}
        </div>
        {tab === 'allocation' && (
          <div className="flex gap-1 overflow-x-auto md:ml-auto -mx-1 px-1">
            {PERIODS.map(p => (
              <button key={p.id} onClick={() => setPeriod(p.id)}
                className={`shrink-0 px-3 h-11 sm:h-9 rounded-full text-[13px] font-medium border transition-colors ${
                  period === p.id
                    ? 'bg-[var(--ink)] text-[var(--paper)] border-[var(--ink)]'
                    : 'border-[var(--line)] text-[var(--ink-soft)]'}`}>
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'allocation' ? (
        <>
          {rows.length === 0 ? (
            <EmptyState title="Nobody can receive leads"
              description="No active member of staff has a leads page, so there is nobody to distribute to." />
          ) : (
            <Card className="!p-0 overflow-hidden">
              {/* Desktop: a real table. */}
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--ink-faint)] border-b border-[var(--line)]">
                      <th className="px-4 py-3 font-medium">Staff</th>
                      <th className="px-4 py-3 font-medium w-32">Allocation</th>
                      <th className="px-4 py-3 font-medium w-20">Active</th>
                      <th className="px-4 py-3 font-medium text-right">Received</th>
                      <th className="px-4 py-3 font-medium text-right">Expected</th>
                      <th className="px-4 py-3 font-medium text-right">Actual</th>
                      <th className="px-4 py-3 font-medium text-right">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(m => {
                      const d = draft[m.profileId]
                      return (
                        <tr key={m.profileId} className="border-b border-[var(--line-soft)] last:border-0">
                          <td className="px-4 py-3">
                            <div className="font-medium text-[var(--ink)]">{m.fullName}</div>
                            <div className="text-xs text-[var(--ink-faint)]">{m.role.replace(/_/g, ' ')}</div>
                          </td>
                          <td className="px-4 py-3">
                            <PercentInput
                              value={d?.percent ?? m.allocationPercent}
                              disabled={!canEdit}
                              onChange={v => set(m.profileId, { percent: v })} />
                          </td>
                          <td className="px-4 py-3">
                            <Toggle on={d?.active ?? m.isActive} disabled={!canEdit}
                              onChange={v => set(m.profileId, { active: v })} />
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-[var(--ink)]">{m.receivedInPeriod}</td>
                          <td className="px-4 py-3 text-right text-[var(--ink-soft)]">{m.expected}</td>
                          <td className="px-4 py-3 text-right text-[var(--ink-soft)]">{m.actualShare}%</td>
                          <td className="px-4 py-3 text-right"><Variance v={m.variance} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile: the same figures, stacked. No sideways scroll. */}
              <div className="md:hidden divide-y divide-[var(--line-soft)]">
                {rows.map(m => {
                  const d = draft[m.profileId]
                  return (
                    <div key={m.profileId} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-[var(--ink)] truncate">{m.fullName}</div>
                          <div className="text-xs text-[var(--ink-faint)]">{m.role.replace(/_/g, ' ')}</div>
                        </div>
                        <Toggle on={d?.active ?? m.isActive} disabled={!canEdit}
                          onChange={v => set(m.profileId, { active: v })} />
                      </div>

                      <div className="mt-3 flex items-center gap-3">
                        <span className="text-xs text-[var(--ink-faint)] w-20">Allocation</span>
                        <PercentInput
                          value={d?.percent ?? m.allocationPercent}
                          disabled={!canEdit}
                          onChange={v => set(m.profileId, { percent: v })} />
                      </div>

                      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                        <Mini label="Got" value={String(m.receivedInPeriod)} />
                        <Mini label="Expected" value={String(m.expected)} />
                        <Mini label="Actual" value={`${m.actualShare}%`} />
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-[var(--ink-faint)]">Var</div>
                          <div className="mt-0.5"><Variance v={m.variance} /></div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* ── What the numbers will actually do, before saving ──────────── */}
          {canEdit && preview && dirty && (
            <Card className="mt-4">
              <p className="text-sm font-semibold text-[var(--ink)]">Next 20 leads with these shares</p>
              <p className="text-xs text-[var(--ink-soft)] mt-1">
                Run through the real scheduler. Nothing is normalised behind you — this is what will happen.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {rows.filter(m => (draft[m.profileId]?.active ?? m.isActive)).map(m => (
                  <span key={m.profileId}
                    className="px-3 py-1.5 rounded-full bg-[var(--accent-bright)] text-[var(--ink)] text-[13px] font-medium">
                    {m.fullName.split(' ')[0]} {preview[m.profileId] ?? 0}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {canEdit && (
            <div className="sticky bottom-[calc(var(--tabbar-h)+12px)] md:bottom-4 mt-4 z-10">
              <Card className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  {issues.length > 0 ? (
                    <p className="text-sm text-[var(--danger)]">{issues[0].message}</p>
                  ) : (
                    <p className="text-sm text-[var(--ink-soft)]">
                      Active shares total <span className="font-semibold text-[var(--ink)]">{activeTotal}%</span>.
                      {dirty ? ' Unsaved changes.' : ' Saved.'}
                    </p>
                  )}
                </div>
                <Button onClick={save} disabled={saving || !dirty || issues.length > 0}>
                  {saving ? 'Saving…' : 'Save allocation'}
                </Button>
              </Card>
            </div>
          )}
        </>
      ) : (
        <Card className="!p-0 overflow-hidden">
          {!events ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : events.length === 0 ? (
            <EmptyState title="No allocations yet"
              description="Once leads are distributed, every decision appears here with the weight that made it." />
          ) : (
            <div className="divide-y divide-[var(--line-soft)]">
              {events.map(e => (
                <div key={e.id} className="p-4 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-[var(--ink)]">
                      <span className="font-medium">{e.leadName || 'A lead'}</span>
                      {' → '}
                      <span className="font-medium">{e.to || 'nobody'}</span>
                    </div>
                    <div className="text-xs text-[var(--ink-faint)] mt-0.5">
                      {timeOf(e.at)}
                      {' · '}{METHOD_LABEL[e.method || e.reason || ''] || e.method || e.reason}
                      {e.weight !== null && ` · weight ${e.weight}%`}
                      {e.source && ` · ${e.source}`}
                    </div>
                    {e.notified === false && (
                      <div className="text-xs text-[var(--attention)] mt-1">
                        Assigned, but the notification failed{e.notifyError ? `: ${e.notifyError}` : '.'}
                      </div>
                    )}
                  </div>
                  {e.notified === true && <Badge tone="accent">Notified</Badge>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

/* ── small pieces ─────────────────────────────────────────────────────────── */

function Figure({ label, value, bright, tone }: {
  label: string; value: string | number; bright?: boolean; tone?: 'attention'
}) {
  const bg = tone === 'attention' ? 'var(--attention)' : bright ? 'var(--accent-bright)' : 'var(--paper)'
  return (
    <div className="rounded-[var(--radius-surface)] p-4 border border-[var(--line)]"
         style={{ background: bg }}>
      <div className="text-[11px] uppercase tracking-wide text-[var(--ink)] opacity-60">{label}</div>
      <div className="text-[var(--text-figure)] font-semibold text-[var(--ink)] leading-tight mt-1">{value}</div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--ink-faint)]">{label}</div>
      <div className="text-sm font-semibold text-[var(--ink)] mt-0.5">{value}</div>
    </div>
  )
}

function Variance({ v }: { v: number }) {
  if (Math.abs(v) < 0.05) return <span className="text-sm text-[var(--ink-faint)]">—</span>
  const over = v > 0
  return (
    <span className={`text-sm font-medium ${over ? 'text-[var(--ink)]' : 'text-[var(--attention)]'}`}>
      {over ? '+' : ''}{v}%
    </span>
  )
}

function PercentInput({ value, onChange, disabled }: {
  value: number; onChange: (v: number) => void; disabled?: boolean
}) {
  return (
    <div className="relative w-24">
      <input
        type="number" min={0} max={100} step={1}
        inputMode="numeric"
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        /* 16px so iOS does not zoom the page when this is focused. */
        className="w-full h-10 pl-3 pr-7 text-[16px] md:text-sm rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] disabled:opacity-60"
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--ink-faint)] pointer-events-none">%</span>
    </div>
  )
}

function Toggle({ on, onChange, disabled }: {
  on: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
  /*
   * A switch that says On or Off in words.
   *
   * It was a bare pill: dark when on, and its knob was positioned without a
   * left edge, so on screen every switch read as the same solid dark shape.
   * Nobody could tell on from off — and a person clicking each one "to switch
   * it on" switched everybody off, which is exactly the state that left every
   * lead unassigned with "Nobody eligible is switched on".
   */
  return (
    <button
      type="button" role="switch" aria-checked={on} disabled={disabled}
      aria-label={on ? 'Receiving leads — switch off' : 'Not receiving leads — switch on'}
      onClick={() => onChange(!on)}
      className={`inline-flex items-center gap-2 min-h-[44px] -my-2 pr-1 shrink-0 disabled:opacity-60`}>
      <span className={`relative w-11 h-6 rounded-full transition-colors ${
        on ? 'bg-[var(--accent)]' : 'bg-[var(--line)]'}`}>
        <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-5' : 'translate-x-0'}`} />
      </span>
      <span className={`text-[13px] font-semibold w-7 text-left ${on ? 'text-[var(--accent)]' : 'text-[var(--ink-faint)]'}`}>
        {on ? 'On' : 'Off'}
      </span>
    </button>
  )
}

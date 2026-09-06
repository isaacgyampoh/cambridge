'use client'
import { useState, useEffect, useCallback } from 'react'
import { mutate } from '@/hooks/useData'
import { toast } from 'sonner'
import { Phone, MessageSquare, Check } from 'lucide-react'
import Link from 'next/link'
import {
  PageHeader, Tabs, MobileList, ListRow, Avatar, Badge,
} from '@/components/ui'
import { telHref, whatsappHref, displayPhone } from '@/lib/ui/contact'

/**
 * The follow-up queue: who this marketer promised to call, and when.
 *
 * ── WHAT WAS BROKEN HERE ───────────────────────────────────────────────────
 *
 * The call and WhatsApp controls rendered as EMPTY coloured squares. Their
 * icons had been stripped from the markup at some point, leaving two anchors
 * with no content — a 36px tinted box that is invisible against the card and
 * gives no clue it can be pressed. Clock, CheckCircle, Phone, MessageSquare
 * and AlertTriangle were all still imported and none of them was rendered,
 * which is the trace of it. The same had happened to the overdue banner, the
 * empty state and the Done button.
 *
 * The WhatsApp link was also assembled by hand as
 *
 *     wa.me/${phone.replace(/^0/, '233')}
 *
 * which does not remove a leading '+' and does not remove spaces, so every
 * number stored as "+233 24 123 4567" produced a URL that opens to nothing.
 * canonicalContact, via whatsappHref, is the one place that knows how to do
 * this and is under test.
 *
 * ── WHAT THIS SCREEN IS FOR ────────────────────────────────────────────────
 *
 * Working down a list of calls. So the row IS the task: the name, how late it
 * is, and the three things you do about it — ring them, message them, mark it
 * done. Snoozing is deliberately one control rather than three: "+1h / +4h /
 * +24h" spent as much width as the person's name.
 */

type QueueRow = {
  id: string
  follow_up_at: string
  reason: string | null
  status: string
  lead: {
    id: string
    full_name: string
    phone: string | null
    status: string
    course_interest: string | null
  } | null
}

const TABS = [
  { key: 'today',    label: 'Today' },
  { key: 'overdue',  label: 'Overdue' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'done',     label: 'Completed' },
]

/** When a snooze lands. Module scope: reading the clock is not a render-time job. */
function snoozeUntil(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString()
}

/** "3 days late" / "in 2 hours" — the phrase somebody would say out loud. */
function whenLabel(iso: string): { text: string; overdue: boolean } {
  const diff = new Date(iso).getTime() - Date.now()
  const overdue = diff < 0
  const mins = Math.round(Math.abs(diff) / 60000)

  let text: string
  if (mins < 60) text = `${mins} min`
  else if (mins < 1440) text = `${Math.round(mins / 60)}h`
  else text = `${Math.round(mins / 1440)}d`

  return { text: overdue ? `${text} late` : `in ${text}`, overdue }
}

export default function ActivitiesPage() {
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('today')
  /** Rows mid-request, so a double tap cannot fire the same update twice. */
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  /*
   * Fetch only. No state is touched here.
   *
   * Setting state synchronously from an effect is what React 19 flags as a
   * cascading render, and it is a real double render on every tab change.
   * This returns the rows and the effect applies them, so the component
   * starts in `loading`, the first paint is already correct, and a tab change
   * turns loading back on from the event handler — which is where a state
   * change caused by a person belongs.
   */
  const fetchQueue = useCallback(async (uid: string, which: string): Promise<QueueRow[] | null> => {
    const now = new Date()
    const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999)

    const filters: Array<{ col: string; op: string; val: string }> = [
      { col: 'marketer_id', op: 'eq', val: uid },
      { col: 'status', op: 'eq', val: which === 'done' ? 'done' : 'pending' },
    ]
    if (which === 'today') {
      filters.push({ col: 'follow_up_at', op: 'lte', val: endOfToday.toISOString() })
    } else if (which === 'overdue') {
      filters.push({ col: 'follow_up_at', op: 'lt', val: now.toISOString() })
    } else if (which === 'upcoming') {
      filters.push({ col: 'follow_up_at', op: 'gt', val: endOfToday.toISOString() })
    }

    const params = new URLSearchParams({
      table: 'follow_up_queue',
      select: '*, lead:lead_id(id, full_name, phone, status, course_interest)',
      filters: JSON.stringify(filters),
      orderBy: 'follow_up_at',
      limit: '50',
    })

    try {
      const res = await fetch(`/api/data?${params}`)
      if (!res.ok) return null
      const json = await res.json()
      return (json.data || []) as QueueRow[]
    } catch {
      return null
    }
  }, [])

  /*
   * Apply a result. A failed load is NOT rendered as an empty list: "no
   * follow-ups due" and "the request failed" look identical otherwise, and
   * one of them means somebody is not being called.
   */
  const apply = useCallback((rows: QueueRow[] | null) => {
    if (!rows) {
      toast.error('Could not load your follow-ups.')
      setQueue([])
    } else {
      setQueue(rows)
    }
    setLoading(false)
  }, [])

  /** Refetch after a change the person just made. */
  const reload = useCallback(async (uid: string, which: string) => {
    apply(await fetchQueue(uid, which))
  }, [apply, fetchQueue])

  // Identify once. The previous version re-fetched /api/auth/me on every tab
  // change, because the effect depended on the filter and did both jobs.
  useEffect(() => {
    let alive = true
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(s => { if (alive && s?.valid) setUserId(s.userId) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!userId) return
    let alive = true
    fetchQueue(userId, tab).then(rows => { if (alive) apply(rows) })
    return () => { alive = false }
  }, [userId, tab, fetchQueue, apply])

  /** A tab change is a person acting, so it may show the loading state. */
  function chooseTab(next: string) {
    if (next === tab) return
    setLoading(true)
    setTab(next)
  }

  async function markDone(id: string) {
    if (busy[id]) return
    setBusy(b => ({ ...b, [id]: true }))
    try {
      await mutate('PATCH', 'follow_up_queue',
        { status: 'done', done_at: new Date().toISOString() }, [{ col: 'id', val: id }])
      toast.success('Marked as done.')
      if (userId) await reload(userId, tab)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update that follow-up.')
    } finally {
      setBusy(b => ({ ...b, [id]: false }))
    }
  }

  async function snooze(id: string, hours: number) {
    if (busy[id]) return
    setBusy(b => ({ ...b, [id]: true }))
    try {
      await mutate('PATCH', 'follow_up_queue', {
        follow_up_at: snoozeUntil(hours),
        status: 'snoozed',
      }, [{ col: 'id', val: id }])
      toast.success(hours >= 24 ? 'Moved to tomorrow.' : `Snoozed ${hours} hours.`)
      if (userId) await reload(userId, tab)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not snooze that follow-up.')
    } finally {
      setBusy(b => ({ ...b, [id]: false }))
    }
  }

  const overdueCount = queue.filter(q => new Date(q.follow_up_at) < new Date()).length

  return (
    <div className="fade-in w-full max-w-3xl">
      <PageHeader
        eyebrow="My work"
        title="Follow-ups"
        description="The people you said you would come back to."
      />

      <Tabs
        tabs={TABS}
        active={tab}
        onChange={chooseTab}
        label="Follow-up periods"
        className="mb-4"
      />

      {/*
        The overdue count as a sentence, not a red panel.

        A filled danger block above the list shouted the number that the rows
        beneath already carry — and it appeared even when every visible row
        was overdue, which is most of the time on this screen.
      */}
      {tab !== 'done' && overdueCount > 0 && (
        <p className="t-sub mb-3">
          <span className="font-semibold text-[var(--danger)]">{overdueCount} overdue</span>
          {' · '}{queue.length} in this view
        </p>
      )}

      <MobileList
        rows={queue}
        rowKey={row => row.id}
        state={loading ? 'loading' : 'ready'}
        emptyTitle={tab === 'done' ? 'Nothing completed yet' : 'All caught up'}
        emptyMessage={
          tab === 'done'
            ? 'Follow-ups you finish will be listed here.'
            : 'No follow-ups are due in this period.'
        }
        renderRow={row => {
          const lead = row.lead
          const when = whenLabel(row.follow_up_at)
          const tel = telHref(lead?.phone)
          const wa = whatsappHref(lead?.phone)
          const done = row.status === 'done'

          return (
            <ListRow
              leading={<Avatar name={lead?.full_name || '?'} size="md" />}
              title={lead?.full_name || 'Lead removed'}
              subtitle={displayPhone(lead?.phone) || 'No phone number'}
              status={
                done
                  ? <Badge tone="success">Done</Badge>
                  : <Badge tone={when.overdue ? 'danger' : 'neutral'}>{when.text}</Badge>
              }
              meta={
                <>
                  {lead?.course_interest && <span className="truncate">{lead.course_interest}</span>}
                  {row.reason && <span className="truncate">{row.reason}</span>}
                </>
              }
              actions={
                <>
                  {tel && (
                    <a href={tel} aria-label={`Call ${lead?.full_name}`}
                      className="w-10 h-10 grid place-items-center rounded-full
                        bg-[var(--brand-soft)] text-[var(--brand)]
                        active:bg-[var(--brand-line)] transition-colors">
                      <Phone size={16} aria-hidden="true" />
                    </a>
                  )}
                  {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer"
                      aria-label={`Message ${lead?.full_name} on WhatsApp`}
                      className="w-10 h-10 grid place-items-center rounded-full
                        bg-[var(--brand-soft)] text-[var(--brand)]
                        active:bg-[var(--brand-line)] transition-colors">
                      <MessageSquare size={16} aria-hidden="true" />
                    </a>
                  )}
                  {!done && (
                    <button type="button" onClick={() => markDone(row.id)}
                      disabled={busy[row.id]}
                      aria-label={`Mark the follow-up for ${lead?.full_name} as done`}
                      className="w-10 h-10 grid place-items-center rounded-full
                        bg-[var(--ok-soft)] text-[var(--ok)]
                        active:brightness-95 disabled:opacity-50 transition">
                      <Check size={17} aria-hidden="true" />
                    </button>
                  )}
                </>
              }
              subrow={
                !done && (
                  <div className="flex items-center gap-2 mt-2">
                    {lead && (
                      <Link href={`/marketer/leads/${lead.id}`}
                        className="text-[12px] font-medium text-[var(--accent)] hover:underline">
                        Open lead
                      </Link>
                    )}
                    <span className="ml-auto flex items-center gap-1.5">
                      {[
                        { h: 1, label: '+1h' },
                        { h: 4, label: '+4h' },
                        { h: 24, label: 'Tomorrow' },
                      ].map(s => (
                        <button key={s.h} type="button"
                          onClick={() => snooze(row.id, s.h)}
                          disabled={busy[row.id]}
                          className="h-11 sm:h-8 px-2.5 rounded-lg text-[12px] font-medium text-[var(--ink-soft)] bg-[var(--line-soft)] active:bg-[var(--line)] disabled:opacity-50 transition">
                          {s.label}
                        </button>
                      ))}
                    </span>
                  </div>
                )
              }
            />
          )
      }}
      />
    </div>
  )
}

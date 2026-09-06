'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useData, mutate } from '@/hooks/useData'
import {
  PageHeader, Button, Tabs, MobileList, ListRow, Badge, SectionHeader,
} from '@/components/ui'

/**
 * The notification centre.
 *
 * ── WHY A PAGE AND NOT JUST THE BELL ───────────────────────────────────────
 *
 * Notifications lived entirely in a dropdown behind a bell in the header. On a
 * phone that is a panel roughly 300px wide showing a handful of rows, with no
 * way to look past the most recent thirty, no way to see only what is unread,
 * and no way to tell a lead assignment from a payment. There are 254
 * notifications in production and no screen that lists them.
 *
 * The bell stays — it is the right shape for "something just happened" — and
 * this is where you go to work through them.
 *
 * Tapping a notification opens the record it is about. That is the whole point
 * of a notification and it is the part that was missing: the dropdown could
 * tell you a lead had been assigned to you without offering any way to reach
 * the lead.
 */

type Notification = {
  id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown> | null
  is_read: boolean
  created_at: string
}

/**
 * The notification_type enum, as it exists in the database.
 *
 * Read from production rather than invented: lead, assignment, admission,
 * payment, reminder, system.
 */
const CATEGORY: Record<string, { label: string; tone: 'accent' | 'success' | 'warning' | 'neutral' }> = {
  lead:       { label: 'Lead',       tone: 'accent' },
  assignment: { label: 'Assignment', tone: 'accent' },
  admission:  { label: 'Admission',  tone: 'success' },
  payment:    { label: 'Payment',    tone: 'success' },
  reminder:   { label: 'Reminder',   tone: 'warning' },
  system:     { label: 'System',     tone: 'neutral' },
}

function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 90) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/**
 * Where a notification leads.
 *
 * The `data` payload carries the id of whatever the notification is about —
 * `lead_id` on every one of the 254 in production. Without this the
 * notification is a statement you cannot act on.
 */
function destination(n: Notification): string | undefined {
  const data = n.data || {}
  const leadId = typeof data.lead_id === 'string' ? data.lead_id : null
  if (leadId) return `/marketer/leads/${leadId}`

  const applicationId = typeof data.application_id === 'string' ? data.application_id : null
  if (applicationId) return '/admin/registrations'

  const prepId = typeof data.prep_record_id === 'string' ? data.prep_record_id : null
  if (prepId) return '/coordinator'

  return undefined
}

export default function NotificationCentre() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [tab, setTab] = useState('unread')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(s => { if (alive && s?.valid) setUserId(s.userId) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const { data: items, state, refetch } = useData<Notification>({
    table: 'notifications',
    select: 'id, type, title, body, data, is_read, created_at',
    filters: userId ? [{ col: 'user_id', op: 'eq', val: userId }] : [],
    orderBy: 'created_at',
    orderAsc: false,
    limit: 200,
    enabled: !!userId,
  })

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: items.length, unread: 0 }
    for (const n of items) {
      if (!n.is_read) out.unread++
      out[n.type] = (out[n.type] || 0) + 1
    }
    return out
  }, [items])

  const shown = useMemo(() => {
    if (tab === 'all') return items
    if (tab === 'unread') return items.filter(n => !n.is_read)
    return items.filter(n => n.type === tab)
  }, [items, tab])

  const tabs = [
    { key: 'unread', label: 'Unread', count: counts.unread },
    { key: 'all', label: 'All', count: counts.all },
    ...Object.keys(CATEGORY)
      .filter(type => counts[type])
      .map(type => ({ key: type, label: CATEGORY[type].label, count: counts[type] })),
  ]

  const markRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return
    try {
      // One request per notification: /api/data filters on a single value, and
      // marking a handful read is not worth a bespoke endpoint. Failures are
      // reported rather than leaving the badge wrong with no explanation.
      await Promise.all(ids.map(id =>
        mutate('PATCH', 'notifications', { is_read: true, read_at: new Date().toISOString() },
          [{ col: 'id', val: id }])
      ))
      refetch()
    } catch {
      toast.error('Could not mark those as read. Please try again.')
    }
  }, [refetch])

  const open = useCallback(async (n: Notification) => {
    const href = destination(n)
    if (!n.is_read) void markRead([n.id])
    if (href) router.push(href)
  }, [markRead, router])

  async function markAllRead() {
    const unread = items.filter(n => !n.is_read).map(n => n.id)
    if (!unread.length) return
    setBusy(true)
    await markRead(unread)
    setBusy(false)
    toast.success(`${unread.length} marked as read`)
  }

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow="You"
        title="Notifications"
        description="Everything the system has told you, newest first."
        actions={
          counts.unread > 0 ? (
            <Button variant="secondary" size="sm" onClick={markAllRead} disabled={busy}>
              {busy ? 'Marking…' : `Mark all ${counts.unread} read`}
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Tabs tabs={tabs} active={tab} onChange={setTab} label="Filter notifications" />
      </div>

      <MobileList
        rows={shown}
        rowKey={n => n.id}
        state={state}
        onRetry={refetch}
        errorTitle="Could not load your notifications"
        errorMessage="This is not an empty inbox — the request failed. Try again."
        emptyTitle={tab === 'unread' ? 'Nothing unread' : 'No notifications'}
        emptyMessage={
          tab === 'unread'
            ? 'You have read everything. Switch to All to look back over them.'
            : 'When a lead is assigned to you, or a payment comes in, you will hear about it here.'
        }
        emptyAction={
          tab === 'unread' && counts.all > 0
            ? <Button variant="secondary" onClick={() => setTab('all')}>Show all</Button>
            : undefined
        }
        renderRow={n => {
          const category = CATEGORY[n.type] || { label: n.type, tone: 'neutral' as const }
          const href = destination(n)
          return (
            <ListRow
              onClick={() => open(n)}
              title={n.title}
              subtitle={n.body || undefined}
              status={
                <span className="flex items-center gap-2">
                  {/* Unread is carried by a dot rather than by weight alone,
                      so it does not depend on noticing a font difference. */}
                  {!n.is_read && (
                    <span aria-label="Unread"
                      className="w-2 h-2 rounded-full bg-[var(--accent)] flex-shrink-0" />
                  )}
                  <Badge tone={category.tone}>{category.label}</Badge>
                </span>
              }
              meta={
                <>
                  <time dateTime={n.created_at} className="tabular-nums">{ago(n.created_at)}</time>
                  {href && <span className="text-[var(--accent)] font-semibold">Open</span>}
                </>
              }
            />
          )
        }}
      />

      {shown.length > 0 && (
        <section className="mt-8">
          <SectionHeader title="About these" />
          <p className="text-[13px] text-[var(--ink-soft)] leading-relaxed">
            Notifications are kept for your account only. Opening one takes you to the record
            it is about and marks it read.
          </p>
        </section>
      )}
    </div>
  )
}

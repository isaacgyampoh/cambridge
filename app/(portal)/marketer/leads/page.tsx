'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Phone, MessageCircle } from 'lucide-react'
import { useData, mutate } from '@/hooks/useData'
import { changeLeadStatus } from '@/lib/leadStatus'
import { telHref, whatsappHref, displayPhone } from '@/lib/ui/contact'
import { describeStatus } from '@/lib/ui/status'
import {
  PageHeader, Button, Search, Tabs, MobileList, ListRow, RowAction,
  StatusBadge, Avatar, Dialog, Textarea, ActionMenu, Card,
} from '@/components/ui'

/**
 * A marketer's leads.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * The list was an accordion. Calling somebody took two taps — one to expand
 * the card, one to press Call — and until you expanded it there was no way to
 * tell a lead you had spoken to from one you had not. This is the screen a
 * marketer spends the day in, on a phone, and its primary action was hidden.
 *
 * The status filter was eight small squares in a four-column grid: on a 375px
 * screen those are about 40px wide with two words of label crushed into them.
 * There was no search at all, so finding one person among two hundred meant
 * scrolling.
 *
 * ── THE FOLLOW-UP FEATURE WAS DEAD ─────────────────────────────────────────
 *
 * Setting a follow-up wrote `next_follow_up` to the `leads` table. That column
 * does not exist there — it belongs to `lead_activities`; leads has
 * `follow_up_at`. The write therefore failed on every call, and the failure
 * was swallowed by `.catch(() => {})`.
 *
 * The "due follow-ups" banner then READ the same phantom column, so it was
 * always empty. The result was a feature that appeared to work — the toast
 * said it had saved — and never did. Measured against production: 1 lead of
 * 186 has a follow-up date, and that one was not set here.
 *
 * Both the write and the read now use `follow_up_at`, which is also what the
 * dashboard counts, so a follow-up set here is a follow-up the dashboard
 * shows.
 */

type Lead = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  status: string
  course_interest: string | null
  follow_up_at: string | null
  created_at: string
  updated_at: string
}

/** Statuses a marketer can set from this screen, and what each one requires. */
type StatusAction = {
  key: string
  needsComment: boolean
  /** Marking this status also sends the registration link. */
  sendsLink?: boolean
  /** What to ask for when a comment is required. */
  prompt?: string
}

const STATUS_ACTIONS: StatusAction[] = [
  { key: 'contacted', needsComment: false },
  { key: 'interested', needsComment: false, sendsLink: true },
  { key: 'follow_up', needsComment: true, prompt: 'What needs following up, and when?' },
  { key: 'next_session', needsComment: true, prompt: 'Which session will they join, and why the wait?' },
  { key: 'zuku', needsComment: true, prompt: 'Why is this lead not qualified?' },
  { key: 'defiled', needsComment: true, prompt: 'Why did they stop the current class to join the next?' },
  { key: 'conflicts', needsComment: true, prompt: 'What is the conflict?' },
  { key: 'deferred', needsComment: true, prompt: 'Give the reason for deferring' },
  { key: 'done', needsComment: false },
]

/** Statuses worth filtering by, in the order a marketer works through them. */
const FILTERS = ['new', 'contacted', 'interested', 'follow_up', 'ready_to_join', 'registered'] as const

function isOverdue(lead: Lead): boolean {
  if (!lead.follow_up_at) return false
  if (['registered', 'lost', 'not_interested'].includes(lead.status)) return false
  return new Date(lead.follow_up_at) <= new Date()
}

export default function MarketerLeads() {
  const router = useRouter()
  const [myId, setMyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('all')

  // The status change that is waiting on a comment.
  const [pending, setPending] = useState<{ lead: Lead; status: string } | null>(null)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  const [transferOpen, setTransferOpen] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(s => { if (alive && s?.valid) setMyId(s.userId) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const { data: leads, state, refetch } = useData<Lead>({
    table: 'leads',
    select: 'id, full_name, phone, email, status, course_interest, follow_up_at, created_at, updated_at',
    filters: myId ? [{ col: 'assigned_to', op: 'eq', val: myId }] : [],
    orderBy: 'updated_at',
    enabled: !!myId,
  })

  /* ── what the list shows ─────────────────────────────────────────────── */

  const overdue = useMemo(() => leads.filter(isOverdue), [leads])

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: leads.length, overdue: overdue.length }
    for (const lead of leads) out[lead.status] = (out[lead.status] || 0) + 1
    return out
  }, [leads, overdue])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return leads.filter(lead => {
      if (tab === 'overdue' && !isOverdue(lead)) return false
      if (tab !== 'all' && tab !== 'overdue' && lead.status !== tab) return false
      if (!needle) return true
      // Phone is searched in both spellings, so 0201234567 and 233201234567
      // both find the same person.
      return (
        lead.full_name?.toLowerCase().includes(needle) ||
        (lead.phone || '').includes(needle) ||
        displayPhone(lead.phone).includes(needle) ||
        (lead.course_interest || '').toLowerCase().includes(needle)
      )
    })
  }, [leads, tab, query])

  const tabs = useMemo(() => [
    { key: 'all', label: 'All', count: counts.all },
    ...(counts.overdue ? [{ key: 'overdue', label: 'Overdue', count: counts.overdue }] : []),
    ...FILTERS.filter(s => counts[s]).map(s => ({
      key: s, label: describeStatus('lead', s).label, count: counts[s],
    })),
  ], [counts])

  /* ── changing a status ───────────────────────────────────────────────── */

  const pickStatus = useCallback((lead: Lead, status: string) => {
    // Registering credits remuneration points and needs a programme, so it
    // goes through the full lead page rather than a menu item.
    if (status === 'registered') { router.push(`/marketer/leads/${lead.id}`); return }

    const def = STATUS_ACTIONS.find(s => s.key === status)
    if (def?.needsComment) { setPending({ lead, status }); setComment(''); return }
    void applyStatus(lead, status, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  async function applyStatus(lead: Lead, status: string, note: string) {
    const def = STATUS_ACTIONS.find(s => s.key === status)
    if (def?.needsComment && !note.trim()) {
      toast.error('Please add a comment so the manager understands why')
      return
    }

    setSaving(true)
    try {
      const result = await changeLeadStatus(lead.id, status)
      if (result.error) { toast.error(result.error); return }

      if (note.trim() && myId) {
        // The status has already changed, so a failure here is partial rather
        // than total — and it is said out loud. A reason nobody can read is
        // not a reason, and silently dropping it is how a manager ends up
        // asking why a lead was disqualified with no answer on record.
        try {
          await mutate('POST', 'lead_activities', {
            lead_id: lead.id, activity_type: 'note',
            subject: describeStatus('lead', status).label,
            description: note, created_by: myId,
          })
        } catch {
          toast.error('Status updated, but your comment could not be saved.')
        }
      }

      /*
       * Schedule the reminder in the follow-up queue.
       *
       * This originally wrote `next_follow_up` on `leads` — a column that does
       * not exist there — and swallowed the failure, so no reminder was ever
       * saved. It then wrote `leads.follow_up_at`, which saved but was invisible
       * to the Follow-ups screen, because that screen reads follow_up_queue.
       *
       * Migration 0014 makes the queue the single source: a trigger mirrors the
       * earliest pending row onto leads.follow_up_at, which is what the leads
       * list and the dashboard filter on. Writing here therefore shows up in
       * all three places at once.
       */
      if (status === 'follow_up' || status === 'next_session') {
        const due = new Date()
        due.setDate(due.getDate() + (status === 'next_session' ? 7 : 2))
        try {
          await mutate('POST', 'follow_up_queue', {
            lead_id: lead.id,
            marketer_id: myId,
            follow_up_at: due.toISOString(),
            reason: note.trim() || describeStatus('lead', status).label,
            priority: 'normal',
            status: 'pending',
          })
        } catch {
          toast.error('Status updated, but the follow-up reminder was not saved.')
        }
      }

      if (def?.sendsLink) {
        const sent = await fetch('/api/leads/send-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId: lead.id }),
        }).then(r => r.json()).catch(() => null)
        toast.success(sent?.success
          ? 'Marked interested — registration link sent on WhatsApp'
          : 'Marked interested — open the lead to send the link')
      } else {
        toast.success(`Moved to ${describeStatus('lead', status).label}`)
      }

      setPending(null)
      setComment('')
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update that lead')
    } finally {
      setSaving(false)
    }
  }

  /* ── render ──────────────────────────────────────────────────────────── */

  const pendingPrompt = pending
    ? STATUS_ACTIONS.find(s => s.key === pending.status)?.prompt || 'Add your comment…'
    : ''

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow="My work"
        title="My leads"
        description="Everyone assigned to you. Call or message straight from the list."
        actions={
          <>
            <Button href="/marketer/leads/new" size="sm">Add a lead</Button>
            <Button variant="secondary" size="sm" onClick={() => setTransferOpen(true)}>
              Request a transfer
            </Button>
          </>
        }
      />

      {/* Overdue leads are the one thing worth interrupting the list for. */}
      {overdue.length > 0 && tab !== 'overdue' && (
        <Card className="p-4 mb-4 border-[var(--warn)]/30 bg-[var(--warn-soft)]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[14px] text-[var(--ink)] leading-snug">
              <strong className="font-semibold">{overdue.length}</strong>{' '}
              {overdue.length === 1 ? 'lead was' : 'leads were'} promised a call by now.
            </p>
            <Button size="sm" variant="secondary" onClick={() => setTab('overdue')}>
              Show
            </Button>
          </div>
        </Card>
      )}

      <div className="space-y-3 mb-4">
        <Search value={query} onChange={setQuery}
          placeholder="Search by name, phone or course" label="Search your leads" />
        <Tabs tabs={tabs} active={tab} onChange={setTab} label="Filter by status" />
      </div>

      <MobileList
        rows={shown}
        rowKey={lead => lead.id}
        state={state}
        onRetry={refetch}
        errorTitle="Could not load your leads"
        errorMessage="This is not an empty list — the request failed. Try again."
        emptyTitle={query || tab !== 'all' ? 'Nothing matches' : 'No leads assigned yet'}
        emptyMessage={
          query || tab !== 'all'
            ? 'Try a different search, or clear the filter to see everyone.'
            : 'Your manager will assign leads to you. They will appear here.'
        }
        emptyAction={
          (query || tab !== 'all')
            ? <Button variant="secondary" onClick={() => { setQuery(''); setTab('all') }}>Show everyone</Button>
            : <Button href="/marketer/leads/new">Add a lead yourself</Button>
        }
        renderRow={lead => {
          const tel = telHref(lead.phone)
          const wa = whatsappHref(
            lead.phone,
            `Hello ${lead.full_name?.split(' ')[0] || ''}, this is Cambridge Center of Excellence.`
          )
          const overdueHere = isOverdue(lead)

          return (
            <ListRow
              href={`/marketer/leads/${lead.id}`}
              leading={<Avatar name={lead.full_name} />}
              title={lead.full_name}
              subtitle={displayPhone(lead.phone)}
              status={<StatusBadge domain="lead" value={lead.status} />}
              meta={
                <>
                  {lead.course_interest && <span className="truncate">{lead.course_interest}</span>}
                  {lead.follow_up_at && (
                    <span className={overdueHere ? 'text-[var(--warn)] font-semibold' : ''}>
                      {overdueHere ? 'Follow-up overdue' : `Follow up ${new Date(lead.follow_up_at)
                        .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                    </span>
                  )}
                </>
              }
              actions={
                <>
                  {/* The device does the work: tel: opens the dialler, wa.me
                      opens WhatsApp. Both were previously two taps away. */}
                  {tel && <RowAction label="Call" href={tel} tone="accent"
                    icon={<Phone size={15} />} />}
                  {wa && <RowAction label="WhatsApp" href={wa} external tone="success"
                    icon={<MessageCircle size={15} />} />}
                  <ActionMenu
                    title={lead.full_name}
                    actions={STATUS_ACTIONS.map(s => ({
                      label: `Mark ${describeStatus('lead', s.key).label.toLowerCase()}`,
                      onClick: () => pickStatus(lead, s.key),
                      disabled: lead.status === s.key,
                    })).concat([
                      { label: 'Mark registered', onClick: () => pickStatus(lead, 'registered'), disabled: false },
                      { label: 'Open full record', onClick: () => router.push(`/marketer/leads/${lead.id}`), disabled: false },
                    ])}
                  />
                </>
              }
            />
          )
        }}
      />

      {/* A status that needs explaining asks for it, rather than silently
          recording a change nobody can account for later. */}
      <Dialog
        open={Boolean(pending)}
        onClose={() => { setPending(null); setComment('') }}
        title={pending ? `Mark ${describeStatus('lead', pending.status).label.toLowerCase()}` : ''}
        description={pending ? `${pending.lead.full_name} — your manager will see this reason.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setPending(null); setComment('') }}>
              Cancel
            </Button>
            <Button
              onClick={() => pending && applyStatus(pending.lead, pending.status, comment)}
              disabled={saving || !comment.trim()}
            >
              {saving ? 'Saving…' : 'Save and update'}
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason"
          hint={pendingPrompt}
          value={comment}
          onChange={setComment}
          rows={4}
          maxLength={500}
        />
      </Dialog>

      <TransferRequest open={transferOpen} onClose={() => setTransferOpen(false)} />
    </div>
  )
}

/* ─────────────────────────────────────────────
   Requesting a lead somebody else owns
   ───────────────────────────────────────────── */

function TransferRequest({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [found, setFound] = useState<{ id: string; full_name: string; owner?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function lookup() {
    if (!phone.trim()) return
    setBusy(true); setFound(null)
    try {
      const d = await fetch('/api/leads/transfer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lookup', phone }),
      }).then(r => r.json())
      if (d.error) { toast.error(d.error); return }
      if (!d.lead) { toast.error('No lead found with that number'); return }
      setFound(d.lead)
    } catch {
      toast.error('Could not reach the server. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!found) return
    setBusy(true)
    try {
      const res = await fetch('/api/leads/transfer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', leadId: found.id, reason }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success('Transfer request sent to your manager')
      setPhone(''); setReason(''); setFound(null)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send that request')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Request a transfer"
      description="Ask for a lead that is currently assigned to someone else."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!found || busy || !reason.trim()}>
            {busy ? 'Sending…' : 'Send request'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2 items-end">
          <Search value={phone} onChange={setPhone} onSubmit={lookup}
            placeholder="Their phone number" label="Lead phone number" className="flex-1" />
          <Button variant="secondary" onClick={lookup} disabled={busy || !phone.trim()}>
            {busy && !found ? 'Looking…' : 'Find'}
          </Button>
        </div>

        {found && (
          <>
            <Card className="p-3.5">
              <div className="flex items-center gap-3">
                <Avatar name={found.full_name} size="sm" />
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-[var(--ink)] truncate">
                    {found.full_name}
                  </div>
                  {found.owner && (
                    <div className="text-[12px] text-[var(--ink-faint)] truncate">
                      Currently with {found.owner}
                    </div>
                  )}
                </div>
              </div>
            </Card>

            <Textarea
              label="Why should this lead move to you?"
              hint="Your manager reads this before deciding."
              value={reason}
              onChange={setReason}
              rows={3}
              maxLength={400}
              required
            />
          </>
        )}
      </div>
    </Dialog>
  )
}

'use client'
import { useData, mutate } from '@/hooks/useData'
import { displayPhone, telHref, whatsappHref } from '@/lib/ui/contact'
import { useState } from 'react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { Phone, Mail, MessageSquare } from 'lucide-react'
import {
  PageHeader, Button, Badge, StatusBadge,
  Tabs, MobileList, ListRow, Avatar, ActionMenu,
} from '@/components/ui'

/**
 * The admissions queue.
 *
 * ── WHAT CHANGED, AND WHAT DID NOT ─────────────────────────────────────────
 *
 * The decisions are untouched: the same statuses, the same /api/admissions/admit
 * call, the same scholarship writes. What changed is that they stopped being
 * six equally-weighted buttons wrapping across a phone screen.
 *
 * Each row now has ONE obvious next step — the thing this admission is
 * actually waiting for — with everything rarer behind a menu. "Request forms",
 * "Awaiting payment", "Admit", "Reject", "Full", "Partial" and "Scholarship:"
 * all sitting in one flex-wrap meant the destructive action and the routine
 * one were the same size, and on a 375px screen they stacked into a block of
 * controls taller than the student's details.
 *
 * Phone and Mail were imported here and never rendered — the contact lines
 * carried `gap-1.5` with nothing to put a gap between. They are now real
 * controls that call and message, which is what somebody working this queue
 * needs when a form has not come back.
 */

type AdmissionRow = {
  id: string
  status: string
  class_mode: string | null
  scholarship_type: string | null
  created_at: string
  course?: { name: string } | null
  lead?: {
    full_name: string
    phone: string | null
    email: string | null
    course_interest: string | null
    assignee?: { full_name: string } | null
  } | null
}

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'muted'

const S: Record<string, { label: string; tone: Tone }> = {
  pending:          { label: 'Pending',           tone: 'warning' },
  awaiting_forms:   { label: 'Awaiting forms',    tone: 'accent' },
  awaiting_payment: { label: 'Awaiting payment',  tone: 'warning' },
  admitted:         { label: 'Admitted',          tone: 'success' },
  rejected:         { label: 'Rejected',          tone: 'danger' },
}

/** The one thing this admission is waiting for, as a single button. */
function nextStep(status: string): { label: string; to: string } | null {
  if (status === 'pending') return { label: 'Request forms', to: 'awaiting_forms' }
  if (status === 'awaiting_forms' || status === 'awaiting_payment') {
    return { label: 'Admit', to: 'admitted' }
  }
  return null
}

export default function AdminAdmissions() {
  const [filter, setFilter] = useState('all')
  const [acting, setActing] = useState<string | null>(null)
  const { data, loading, refetch } = useData<AdmissionRow>({
    table: 'admissions',
    // The mode this admission is for — the field that decides which letter
    // the student is sent, and which appeared on none of these screens.
    select: '*, class_mode, lead:lead_id(full_name,phone,email,course_interest,assigned_to,assignee:assigned_to(full_name)), course:course_id(name)',
    orderBy: 'created_at', orderAsc: false, limit: 300,
  })

  async function updateStatus(id: string, status: string) {
    setActing(id)
    try {
      if (status === 'admitted') {
        // Admit + auto-send admission letter
        const res = await fetch('/api/admissions/admit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admissionId: id }),
        }).then(r => r.json())
        if (res.error) throw new Error(res.error)
        toast.success(res.emailed ? 'Admitted — admission letter sent' : 'Admitted (no email on file)')
      } else {
        await mutate('PATCH', 'admissions', { status }, [{ col: 'id', val: id }])
        toast.success('Status updated')
      }
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update that admission.')
    } finally { setActing(null) }
  }

  async function setScholarship(id: string, type: string | null) {
    setActing(id)
    try {
      await mutate('PATCH', 'admissions', {
        scholarship_type: type,
        scholarship_decided: !!type,
      }, [{ col: 'id', val: id }])
      toast.success(type ? `${type === 'full' ? 'Full' : 'Partial'} scholarship granted` : 'Scholarship cleared')
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record that decision.')
    } finally { setActing(null) }
  }

  const counts = data.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1
    return acc
  }, {})

  const filtered = filter === 'all' ? data : data.filter(a => a.status === filter)

  const tabs = [
    { key: 'all', label: 'All', count: data.length },
    ...Object.keys(S).map(k => ({ key: k, label: S[k].label, count: counts[k] || 0 })),
  ]

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Admissions"
        title="Admissions queue"
        description="Process students from ready-to-join through to admitted."
      />

      <Tabs
        tabs={tabs}
        active={filter}
        onChange={setFilter}
        label="Admission stages"
        className="mb-4"
      />

      {/* MobileList owns loading, empty and error, so this screen cannot
          render a failed load as "no admissions" the way it used to. */}
      <MobileList
        rows={filtered}
        rowKey={a => a.id}
        state={loading ? 'loading' : 'ready'}
        emptyTitle="Nothing in this stage"
        emptyMessage="Admissions appear here once a student is ready to join."
        renderRow={a => {
          const lead = a.lead
          const sc = S[a.status] || S.pending
          const step = nextStep(a.status)
          const busy = acting === a.id
          const tel = telHref(lead?.phone)
          const wa = whatsappHref(lead?.phone)

          /*
           * Everything that is not the obvious next step. Reject lives here
           * rather than beside "Admit": they were the same size and one of
           * them ends a person's application.
           */
          const menu: Array<{ label: string; onClick: () => void; tone?: 'danger'; hint?: string }> = []
          if (a.status === 'pending') {
            menu.push({
              label: 'Mark as awaiting payment',
              onClick: () => updateStatus(a.id, 'awaiting_payment'),
              hint: 'The forms are in; the fee is not',
            })
          }
          if (a.scholarship_type) {
            menu.push({
              label: 'Clear the scholarship',
              onClick: () => setScholarship(a.id, null),
            })
          } else {
            menu.push(
              { label: 'Grant a full scholarship', onClick: () => setScholarship(a.id, 'full') },
              { label: 'Grant a partial scholarship', onClick: () => setScholarship(a.id, 'partial') },
            )
          }
          if (!['rejected', 'admitted'].includes(a.status)) {
            menu.push({
              label: 'Reject this admission',
              onClick: () => updateStatus(a.id, 'rejected'),
              tone: 'danger',
              hint: 'The applicant is turned down',
            })
          }

          return (
            <ListRow
              leading={<Avatar name={lead?.full_name || '?'} size="md" />}
              title={lead?.full_name || 'Unknown applicant'}
              subtitle={a.course?.name || lead?.course_interest || 'No course set'}
              status={<Badge tone={sc.tone}>{sc.label}</Badge>}
              meta={
                <>
                  {/* Which letter this student is due — the field that
                      decides it, shown on the queue it is issued from. */}
                  <StatusBadge domain="classMode" value={a.class_mode} size="sm" showDot />
                  {a.scholarship_type && (
                    <Badge tone="accent">
                      {a.scholarship_type === 'full' ? 'Full scholarship' : 'Partial scholarship'}
                    </Badge>
                  )}
                  {lead?.phone && <span>{displayPhone(lead.phone)}</span>}
                  <span>{formatDateTime(a.created_at)}</span>
                  {lead?.assignee?.full_name && (
                    <span>Registered by {lead.assignee.full_name.split(' ')[0]}</span>
                  )}
                </>
              }
              actions={
                <>
                  {step && (
                    <Button size="sm" disabled={busy}
                      onClick={() => updateStatus(a.id, step.to)}>
                      {busy ? 'Working…' : step.label}
                    </Button>
                  )}
                  {tel && (
                    <a href={tel} aria-label={`Call ${lead?.full_name}`}
                      className="w-10 h-10 grid place-items-center rounded-full flex-shrink-0
                        bg-[var(--brand-soft)] text-[var(--brand)]
                        active:bg-[var(--brand-line)] transition-colors">
                      <Phone size={16} aria-hidden="true" />
                    </a>
                  )}
                  {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer"
                      aria-label={`Message ${lead?.full_name} on WhatsApp`}
                      className="w-10 h-10 grid place-items-center rounded-full flex-shrink-0
                        bg-[var(--brand-soft)] text-[var(--brand)]
                        active:bg-[var(--brand-line)] transition-colors">
                      <MessageSquare size={16} aria-hidden="true" />
                    </a>
                  )}
                  {lead?.email && (
                    <a href={`mailto:${lead.email}`} aria-label={`Email ${lead.full_name}`}
                      className="w-10 h-10 grid place-items-center rounded-full flex-shrink-0
                        border border-[var(--line)] text-[var(--ink-soft)]
                        active:bg-[var(--canvas)] transition-colors">
                      <Mail size={16} aria-hidden="true" />
                    </a>
                  )}
                  <span className="ml-auto">
                    <ActionMenu
                      label={`More actions for ${lead?.full_name || 'this admission'}`}
                      title="Admission actions"
                      actions={menu}
                    />
                  </span>
                </>
              }
            />
          )
      }}
      />
    </div>
  )
}

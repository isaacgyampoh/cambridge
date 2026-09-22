'use client'
import { useData, mutate } from '@/hooks/useData'
import { displayPhone, telHref, whatsappHref } from '@/lib/ui/contact'
import { displayName } from '@/lib/ui/name'
import { useState } from 'react'
import Modal from '@/components/shared/Modal'
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

  /*
   * ── ADMISSION LETTERS ARE SENT BY A PERSON, NEVER BY THE SYSTEM ─────────
   *
   * Admitting used to email the letter in the same request, and paying used
   * to send one before anybody here saw it — an old stored letter with old
   * fees and no date. Now the letter is opened, read and sent from here, and
   * nowhere else.
   */
  type LetterPreview = {
    studentName: string | null; email: string | null; programme: string | null
    modeLabel: string | null; fee: string | null; registrationFee: string | null
    letterDate: string; startDate: string | null; admissionNumber: string | null
    alreadySent: boolean; sentAt: string | null; blocked: string | null
  }
  const [letterFor, setLetterFor] = useState<string | null>(null)
  const [letter, setLetter] = useState<LetterPreview | null>(null)
  const [letterError, setLetterError] = useState<string | null>(null)
  const [letterBusy, setLetterBusy] = useState<'loading' | 'review' | 'send' | null>(null)
  const [reviewUrl, setReviewUrl] = useState<string | null>(null)
  const [confirmResend, setConfirmResend] = useState(false)

  async function openLetter(admissionId: string) {
    setLetterFor(admissionId); setLetter(null); setLetterError(null)
    setReviewUrl(null); setConfirmResend(false); setLetterBusy('loading')
    try {
      const res = await fetch(`/api/admissions/letter?admissionId=${admissionId}`)
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || 'The admission letter could not be prepared.')
      setLetter(d.preview)
    } catch (e) {
      setLetterError(e instanceof Error ? e.message : 'The admission letter could not be prepared.')
    } finally { setLetterBusy(null) }
  }

  function closeLetter() {
    setLetterFor(null); setLetter(null); setLetterError(null); setReviewUrl(null); setConfirmResend(false)
  }

  async function reviewLetter() {
    if (!letterFor) return
    setLetterBusy('review')
    try {
      const res = await fetch('/api/admissions/letter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admissionId: letterFor, action: 'review' }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || 'The letter could not be generated for review.')
      setReviewUrl(d.pdfUrl)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The letter could not be generated for review.')
    } finally { setLetterBusy(null) }
  }

  async function sendLetter() {
    if (!letterFor || !letter) return
    setLetterBusy('send')
    try {
      const res = await fetch('/api/admissions/letter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admissionId: letterFor, action: 'send', confirm: true,
          resend: letter.alreadySent && confirmResend,
        }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) {
        if (d?.needsResendConfirmation) setLetter(l => l ? { ...l, alreadySent: true } : l)
        throw new Error(d?.error || 'The admission letter was not sent.')
      }
      toast.success(`Admission letter sent to ${letter.email}`)
      if (d.recorded === false) {
        toast.warning('The letter went, but could not be marked as sent. Tell an administrator.')
      }
      closeLetter()
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The admission letter was not sent.')
    } finally { setLetterBusy(null) }
  }

  async function updateStatus(id: string, status: string) {
    setActing(id)
    try {
      if (status === 'admitted') {
        // Admitting records the decision only. The letter is sent separately,
        // by a person, after reading it.
        const res = await fetch('/api/admissions/admit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admissionId: id }),
        }).then(r => r.json())
        if (res.error) throw new Error(res.error)
        toast.success('Admitted. No letter has been sent — use "Send admission letter" when it is ready.')
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
          if (a.status === 'admitted') {
            menu.unshift({
              label: 'Send admission letter',
              onClick: () => openLetter(a.id),
              hint: 'Review the current fee and date, then send',
            })
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
              leading={<Avatar name={displayName(lead?.full_name) || '?'} size="md" />}
              title={displayName(lead?.full_name) || 'Unknown applicant'}
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
                  {a.status === 'admitted' && (
                    <Button size="sm" variant="secondary" onClick={() => openLetter(a.id)}>
                      Send letter
                    </Button>
                  )}
                  {tel && (
                    <a href={tel} aria-label={`Call ${displayName(lead?.full_name)}`}
                      className="w-10 h-10 grid place-items-center rounded-full flex-shrink-0
                        bg-[var(--brand-soft)] text-[var(--brand)]
                        active:bg-[var(--brand-line)] transition-colors">
                      <Phone size={16} aria-hidden="true" />
                    </a>
                  )}
                  {wa && (
                    <a href={wa} rel="noopener noreferrer"
                      aria-label={`Message ${displayName(lead?.full_name)} on WhatsApp`}
                      className="w-10 h-10 grid place-items-center rounded-full flex-shrink-0
                        bg-[var(--brand-soft)] text-[var(--brand)]
                        active:bg-[var(--brand-line)] transition-colors">
                      <MessageSquare size={16} aria-hidden="true" />
                    </a>
                  )}
                  {lead?.email && (
                    <a href={`mailto:${lead.email}`} aria-label={`Email ${displayName(lead.full_name)}`}
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

      {/* ── Review and send an admission letter ─────────────────────────── */}
      <Modal open={!!letterFor} onClose={closeLetter}>
        <div className="p-5 sm:p-6">
          <h2 className="font-display text-lg font-semibold text-[var(--ink)]">Send admission letter?</h2>

          {letterBusy === 'loading' && !letter && (
            <p className="text-sm text-[var(--ink-soft)] mt-3">Preparing the letter from the current record…</p>
          )}

          {letterError && (
            <p className="text-sm text-[var(--danger)] mt-3">{letterError}</p>
          )}

          {letter && (
            <>
              <p className="text-sm text-[var(--ink-soft)] mt-1">
                Built now from the current course fee and today&rsquo;s date. Check it before it goes.
              </p>

              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-[var(--ink-faint)]">Student</dt>
                <dd className="font-medium text-[var(--ink)]">{letter.studentName || '—'}</dd>
                <dt className="text-[var(--ink-faint)]">Programme</dt>
                <dd className="font-medium text-[var(--ink)]">{letter.programme || '—'}</dd>
                <dt className="text-[var(--ink-faint)]">Study mode</dt>
                <dd className="font-medium text-[var(--ink)]">{letter.modeLabel || '—'}</dd>
                <dt className="text-[var(--ink-faint)]">Fee</dt>
                <dd className="font-semibold text-[var(--ink)]">{letter.fee || '—'}</dd>
                {letter.registrationFee && (<>
                  <dt className="text-[var(--ink-faint)]">Registration</dt>
                  <dd className="font-medium text-[var(--ink)]">{letter.registrationFee}</dd>
                </>)}
                <dt className="text-[var(--ink-faint)]">Letter date</dt>
                <dd className="font-medium text-[var(--ink)]">{letter.letterDate}</dd>
                {letter.startDate && (<>
                  <dt className="text-[var(--ink-faint)]">Start date</dt>
                  <dd className="font-medium text-[var(--ink)]">{letter.startDate}</dd>
                </>)}
                <dt className="text-[var(--ink-faint)]">Admission no.</dt>
                <dd className="font-medium text-[var(--ink)]">{letter.admissionNumber || '—'}</dd>
                <dt className="text-[var(--ink-faint)]">Recipient</dt>
                <dd className="font-medium text-[var(--ink)] break-all">{letter.email || '—'}</dd>
              </dl>

              {letter.blocked && (
                <p className="mt-4 rounded-[var(--radius-control)] bg-[var(--attention-soft)] p-3 text-sm text-[var(--ink)]">
                  {letter.blocked}
                </p>
              )}

              {!letter.blocked && letter.alreadySent && (
                <label className="mt-4 flex items-start gap-3 rounded-[var(--radius-control)] bg-[var(--attention-soft)] p-3 text-sm text-[var(--ink)] cursor-pointer">
                  <input type="checkbox" className="mt-0.5 w-5 h-5 shrink-0"
                    checked={confirmResend} onChange={e => setConfirmResend(e.target.checked)} />
                  <span>
                    A letter was already sent to this student
                    {letter.sentAt ? ` on ${new Date(letter.sentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.
                    Tick to send it again.
                  </span>
                </label>
              )}

              {reviewUrl && (
                <p className="mt-4 text-sm">
                  <a href={reviewUrl} target="_blank" rel="noopener noreferrer"
                    className="font-semibold text-[var(--accent)] underline">
                    Open the letter (PDF) — not sent
                  </a>
                </p>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2 mt-5">
            <Button variant="secondary" onClick={closeLetter} className="flex-1 min-w-[100px]">Cancel</Button>
            <Button variant="secondary" onClick={reviewLetter}
              disabled={!letter || !!letter.blocked || letterBusy !== null}
              className="flex-1 min-w-[120px]">
              {letterBusy === 'review' ? 'Generating…' : 'Review letter'}
            </Button>
            <Button onClick={sendLetter}
              disabled={!letter || !!letter.blocked || letterBusy !== null || (letter.alreadySent && !confirmResend)}
              className="flex-1 min-w-[160px]">
              {letterBusy === 'send' ? 'Sending…' : letter?.alreadySent ? 'Send again' : 'Send admission letter'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

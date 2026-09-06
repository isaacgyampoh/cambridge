'use client'
import { useState, useEffect, use } from 'react'
import { displayPhone } from '@/lib/ui/contact'
import { readableStatus } from '@/lib/ui/status'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, inputClass } from '@/components/ui'
import Modal from '@/components/shared/Modal'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/useConfirm'
import { X } from 'lucide-react'
import type { Application } from '@/types'

type Enrollment = {
  id: string
  full_name: string
  phone?: string | null
  email?: string | null
  fees_paid?: boolean
  status?: string | null
}

export default function ClassStudents({ params }: { params: Promise<{ id: string }> }) {
  const { confirm, dialog } = useConfirm()
  const { id: batchId } = use(params)
  const [batch, setBatch] = useState<any>(null)
  const [enrolled, setEnrolled] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)

  // Moving a student to a later cohort — everything they have paid follows
  // them, so an emergency does not cost them their money or their place.
  const [defer, setDefer] = useState<any>(null)
  const [batches, setBatches] = useState<any[]>([])
  const [deferTo, setDeferTo] = useState('')
  const [deferReason, setDeferReason] = useState('')
  const [deferring, setDeferring] = useState(false)

  async function openDefer(e: any) {
    setDefer(e); setDeferTo(''); setDeferReason('')
    const params = new URLSearchParams({
      table: 'batches', select: 'id, name, start_date, status',
      orderBy: 'start_date', limit: '100',
    })
    const d = await fetch(`/api/data?${params}`).then(r => r.json()).catch(() => ({ data: [] }))
    setBatches((d.data || []).filter((b: any) => b.id !== batchId && b.status !== 'completed'))
  }

  async function confirmDefer() {
    if (!deferTo) { toast.error('Choose the class they are moving to'); return }
    setDeferring(true)
    const d = await fetch('/api/classes/defer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollmentId: defer.id, toBatchId: deferTo, reason: deferReason }),
    }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    setDeferring(false)
    if (d.error) { toast.error(d.error); return }
    toast.success(`${defer.full_name} moved to ${d.movedTo}. GH₵${Number(d.amountCarried || 0).toFixed(2)} carried over.`)
    setDefer(null); load()
  }
  const [search, setSearch] = useState('')
  const [acting, setActing] = useState<string | null>(null)
  const [blasting, setBlasting] = useState(false)
  const [showAttendance, setShowAttendance] = useState(false)
  const [attendance, setAttendance] = useState<any>(null)

  async function loadAttendance() {
    try {
      const d = await fetch(`/api/classes/attendance?batchId=${batchId}`).then(r => r.json())
      if (!d.error) setAttendance(d)
    } catch { /* ignore */ }
  }

  async function sendSigninLink() {
    if (!await confirm({
      title: "Send today's sign-in link?",
      message: 'Every active student in this class receives it on WhatsApp straight away.',
      confirmLabel: 'Send link',
      tone: 'accent',
    })) return
    setBlasting(true)
    try {
      const res = await fetch('/api/classes/signin-blast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success(`Sign-in link sent to ${res.sent} of ${res.total} students`)
    } catch (e: any) { toast.error(e.message) }
    finally { setBlasting(false) }
  }

  // All paid registrations (candidates to enroll)
  const { data: apps } = useData<Application>({
    table: 'applications', select: 'id, full_name, email, phone, payment_status, course:course_id(name)',
    orderBy: 'created_at', orderAsc: false, limit: 1000,
  })

  async function load() {
    setLoading(true)
    const [bRes, eRes] = await Promise.all([
      fetch(`/api/data?${new URLSearchParams({ table: 'batches', select: '*, course:course_id(name)', filters: JSON.stringify([{ col: 'id', op: 'eq', val: batchId }]), limit: '1' })}`).then(r => r.json()),
      fetch(`/api/data?${new URLSearchParams({ table: 'class_enrollments', select: '*', filters: JSON.stringify([{ col: 'batch_id', op: 'eq', val: batchId }]), orderBy: 'enrolled_at', limit: '500' })}`).then(r => r.json()),
    ])
    setBatch(bRes.data?.[0] || null)
    setEnrolled(eRes.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [batchId])

  const enrolledAppIds = new Set(enrolled.map((e: any) => e.application_id))
  const candidates = apps.filter((a) =>
    !enrolledAppIds.has(a.id) &&
    (!search || (a.full_name || '').toLowerCase().includes(search.toLowerCase()) || (a.phone || '').includes(search))
  )

  async function enroll(applicationId: string) {
    setActing(applicationId)
    try {
      const res = await fetch('/api/classes/enroll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, applicationId }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success(res.zoomSent ? 'Enrolled — Zoom link sent' : 'Student enrolled')
      load()
    } catch (e: any) { toast.error(e.message) }
    finally { setActing(null) }
  }

  async function remove(e: any) {
    if (!await confirm({
      title: `Remove ${e.full_name} from this class?`,
      message: 'They lose access to the class link and its materials. Their registration and payments are not affected.',
      confirmLabel: 'Remove from class',
    })) return
    setActing(e.id)
    try {
      await fetch('/api/classes/enroll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, applicationId: e.application_id, remove: true }),
      })
      toast.success('Removed'); load()
    } catch { toast.error('Failed') }
    finally { setActing(null) }
  }

  async function patch(e: any, fields: any, label: string) {
    setActing(e.id)
    try {
      await fetch('/api/data', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: 'class_enrollments', data: fields, filters: [{ col: 'id', val: e.id }] }),
      })
      toast.success(label); load()
    } catch { toast.error('Failed') }
    finally { setActing(null) }
  }

  async function togglePaid(e: any) {
    const nowPaid = !e.fees_paid
    setActing(e.id)
    try {
      await fetch('/api/data', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: 'class_enrollments', data: { fees_paid: nowPaid }, filters: [{ col: 'id', val: e.id }] }),
      })
      // If they're now fully paid AND already completed, auto-issue the certificate
      if (nowPaid && e.status === 'completed') {
        const res = await fetch('/api/classes/complete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enrollmentId: e.id, completed: true }),
        }).then(r => r.json())
        if (res.certIssued) { toast.success(res.sent ? 'Fees paid — certificate sent to student' : 'Fees paid — certificate issued'); load(); setActing(null); return }
      }
      toast.success(nowPaid ? 'Full fees marked paid' : 'Marked unpaid'); load()
    } catch { toast.error('Failed') }
    finally { setActing(null) }
  }

  async function markComplete(e: any, completed: boolean) {
    setActing(e.id)
    try {
      const res = await fetch('/api/classes/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId: e.id, completed }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      if (!completed) toast.success('Reopened')
      else if (res.certIssued) toast.success(res.sent ? 'Completed — certificate sent to student' : 'Completed — certificate issued')
      else toast.success('Completed — certificate pending (full fees not yet paid)')
      load()
    } catch (e: any) { toast.error(e.message || 'Failed') }
    finally { setActing(null) }
  }

  const enrolledColumns: Column<Enrollment>[] = [
    { key: 'student', header: 'Student', primary: true, render: e => e.full_name },
    {
      key: 'contact', header: 'Contact', secondary: true,
      render: e => [
        e.phone && displayPhone(e.phone),
        e.email,
      ].filter(Boolean).join(' · ') || '—',
    },
    {
      key: 'fees', header: 'Full fees',
      render: e => (
        <button disabled={acting === e.id} onClick={() => togglePaid(e)}
          className={`text-[12px] font-medium px-2.5 py-1 rounded-full ring-1 ring-inset transition min-h-[32px]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
            ${e.fees_paid
              ? 'bg-[var(--ok-soft)] text-[var(--ok)] ring-emerald-200'
              : 'bg-[var(--line-soft)] text-[var(--ink-soft)] ring-[var(--line)] hover:ring-[var(--accent)]'}`}>
          {e.fees_paid ? 'Paid in full' : 'Mark paid'}
        </button>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: e => e.status === 'completed'
        ? <Badge tone="success">Completed</Badge>
        : <Badge tone="neutral">Active</Badge>,
    },
    {
      key: 'actions', header: 'Actions',
      render: e => (
        <span className="flex items-center gap-1.5 flex-wrap sm:justify-end">
          {e.status !== 'completed' ? (
            <>
              <Button size="sm" variant="secondary" disabled={acting === e.id}
                onClick={() => openDefer(e)}>Move class</Button>
              <Button size="sm" variant="secondary" disabled={acting === e.id}
                onClick={() => markComplete(e, true)}>Mark done</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" disabled={acting === e.id}
              onClick={() => markComplete(e, false)}>Reopen</Button>
          )}
          <Button size="sm" variant="ghost" disabled={acting === e.id}
            onClick={() => remove(e)}>Remove</Button>
        </span>
      ),
    },
  ]

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      {dialog}
      <PageHeader
        eyebrow={batch?.course?.name || 'Class'}
        title={batch ? `${batch.name} — students` : 'Class students'}
        description="Enroll registered students, track full-fee payment, and mark completion."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={sendSigninLink} disabled={blasting} >
              {blasting ? 'Sending…' : 'Send sign-in link'}
            </Button>
            <Button onClick={() => setAddOpen(true)} >Enroll student</Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 mb-5">
        <Badge tone="accent">{enrolled.length} enrolled</Badge>
        <Badge tone="success">{enrolled.filter((e: any) => e.fees_paid).length} fees paid</Badge>
        <Badge tone="neutral">{enrolled.filter((e: any) => e.status === 'completed').length} completed</Badge>
        <button onClick={async () => {
          if (!await confirm({
            title: 'Issue certificates?',
            message: 'Everyone in this class who has finished paying receives a certificate. Issued certificates cannot be withdrawn.',
            confirmLabel: 'Issue certificates',
            tone: 'accent',
          })) return
          const d = await fetch('/api/certificates/issue', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchId }),
          }).then(r => r.json()).catch(() => ({ error: 'failed' }))
          if (d.error) { toast.error(d.error); return }
          const parts = [`${d.issued} certificate${d.issued === 1 ? '' : 's'} issued`]
          if (d.skipped) parts.push(`${d.skipped} skipped (fees outstanding)`)
          // A batch that half worked says so. Reporting only the successes is
          // how a student ends up with a certificate nobody can find.
          if (d.failed) {
            toast.error(
              `${parts.join('. ')}. ${d.failed} could not be recorded: ` +
              `${(d.failedNames || []).map((f: { name: string }) => f.name).join(', ')}. ` +
              `Please try those again.`
            )
          } else {
            toast.success(`${parts.join('. ')}.`)
          }
        }}
          className="inline-flex items-center gap-1.5 h-10 px-4 bg-white border border-[var(--line)] text-[var(--ink-soft)] rounded-lg text-sm font-medium hover:border-[var(--ink-faint)] transition mr-2">
          Issue certificates
        </button>
        <button onClick={() => { setShowAttendance(s => !s); if (!attendance) loadAttendance() }}
          className="ml-auto text-xs font-medium text-[var(--accent)] hover:underline">
          {showAttendance ? 'Hide attendance' : "Today's attendance"}
        </button>
      </div>

      {showAttendance && (
        <Card className="p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-[var(--ink)]">Today’s attendance</h3>
            <span className="text-xs text-[var(--ink-faint)]">{attendance?.date || ''}</span>
          </div>
          {!attendance ? <Spinner /> : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-xl bg-[var(--accent-soft)] p-3 text-center">
                  <div className="font-display text-2xl font-semibold text-[var(--accent)]">{attendance.presentCount}</div>
                  <div className="text-[12px] text-[var(--ink-soft)]">Came to class</div>
                </div>
                <div className="rounded-xl bg-[var(--canvas)] p-3 text-center">
                  <div className="font-display text-2xl font-semibold text-[var(--ink-soft)]">{attendance.absentCount}</div>
                  <div className="text-[12px] text-[var(--ink-soft)]">Absent</div>
                </div>
                <div className="rounded-xl bg-[var(--canvas)] p-3 text-center">
                  <div className="font-display text-2xl font-semibold text-[var(--ink)]">{attendance.total}</div>
                  <div className="text-[12px] text-[var(--ink-soft)]">Total</div>
                </div>
              </div>
              <p className="text-[12px] text-[var(--ink-faint)] mb-2">{attendance.presentCount} booklets needed for those present.</p>
              <div className="max-h-64 overflow-y-auto divide-y divide-[var(--line-soft)]">
                {attendance.students.map((s: any) => (
                  <div key={s.enrollmentId} className="flex items-center justify-between py-2">
                    <span className="text-sm text-[var(--ink)]">{s.name}</span>
                    <div className="flex items-center gap-3">
                      {s.balance > 0 && <span className="text-[12px] text-[var(--warn)]">GHS {s.balance.toFixed(2)} owing</span>}
                      <Badge tone={s.present ? 'success' : 'neutral'}>{s.present ? 'Present' : 'Absent'}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      <DataTable<Enrollment>
        caption="Students in this class"
        state={loading ? 'loading' : 'ready'}
        rows={enrolled}
        rowKey={e => e.id}
        columns={enrolledColumns}
        emptyTitle="No students enrolled yet"
        emptyMessage="Enroll registered students into this class to send them Zoom links, materials and certificates."
        emptyAction={<Button onClick={() => setAddOpen(true)}>Enroll a student</Button>}
      />

      {/* Enroll modal */}
      {/* Move a student to another class */}
      {defer && (
        <Modal open={!!defer} onClose={() => setDefer(null)} maxWidth="max-w-md">
          <div className="p-6">
            <h2 className="font-semibold text-[var(--ink)] mb-1">Move {defer.full_name}</h2>
            <p className="text-[13px] text-[var(--ink-soft)] mb-4">
              Everything they have paid follows them to the new class, and their attendance resets so
              they start fresh. They will be told by WhatsApp.
            </p>

            <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-1.5">Move to</label>
            <select value={deferTo} onChange={e => setDeferTo(e.target.value)} className={inputClass}>
              <option value="">Choose a class…</option>
              {batches.map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.start_date ? ` — starts ${new Date(b.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
                </option>
              ))}
            </select>

            <label className="block text-[13px] font-medium text-[var(--ink-soft)] mt-4 mb-1.5">Reason (optional)</label>
            <input value={deferReason} onChange={e => setDeferReason(e.target.value)}
              placeholder="e.g. family emergency" className={inputClass} />

            <div className="flex gap-2 mt-6">
              <Button onClick={confirmDefer} disabled={deferring}>{deferring ? 'Moving…' : 'Move student'}</Button>
              <Button variant="secondary" onClick={() => setDefer(null)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} maxWidth="max-w-xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">Enroll a student</h2>
            <button type="button" onClick={() => setAddOpen(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]" aria-label="Close"><X size={18} aria-hidden="true" /></button>
          </div>
          <div className="relative mb-4">
            
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search registered students..." className={inputClass + ' pl-9'} autoFocus />
          </div>
          <div className="max-h-80 overflow-y-auto -mx-2 px-2">
            {candidates.length === 0 ? (
              <p className="text-sm text-[var(--ink-faint)] text-center py-8">No matching registered students.</p>
            ) : candidates.slice(0, 40).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-[var(--line-soft)] last:border-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--ink)] truncate">{a.full_name}</div>
                  <div className="text-[12px] text-[var(--ink-faint)]">{a.course?.name || '—'} · {readableStatus(a.payment_status)}</div>
                </div>
                <Button size="sm" disabled={acting === a.id} onClick={() => enroll(a.id)}>
                  {acting === a.id ? '…' : 'Enroll'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  )
}

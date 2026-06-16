'use client'
import { useState, useEffect, use } from 'react'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, inputClass } from '@/components/ui'
import Modal from '@/components/shared/Modal'
import { Users, Plus, Search, X, Check, GraduationCap, UserMinus } from 'lucide-react'
import { toast } from 'sonner'

export default function ClassStudents({ params }: { params: Promise<{ id: string }> }) {
  const { id: batchId } = use(params)
  const [batch, setBatch] = useState<any>(null)
  const [enrolled, setEnrolled] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [acting, setActing] = useState<string | null>(null)

  // All paid registrations (candidates to enroll)
  const { data: apps } = useData<any>({
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
  const candidates = apps.filter((a: any) =>
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
    if (!confirm(`Remove ${e.full_name} from this class?`)) return
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

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow={batch?.course?.name || 'Class'}
        title={batch ? `${batch.name} — students` : 'Class students'}
        description="Enroll registered students, track full-fee payment, and mark completion."
        actions={<Button onClick={() => setAddOpen(true)} icon={<Plus size={15} />}>Enroll student</Button>}
      />

      <div className="flex flex-wrap gap-2 mb-5">
        <Badge tone="accent">{enrolled.length} enrolled</Badge>
        <Badge tone="success">{enrolled.filter((e: any) => e.fees_paid).length} fees paid</Badge>
        <Badge tone="neutral">{enrolled.filter((e: any) => e.status === 'completed').length} completed</Badge>
      </div>

      {loading ? <Spinner /> : enrolled.length === 0 ? (
        <EmptyState icon={<Users size={20} />} title="No students enrolled yet"
          description="Enroll registered students into this class to send them Zoom links, materials, and certificates."
          action={<Button onClick={() => setAddOpen(true)}>Enroll a student</Button>} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  {['Student', 'Contact', 'Full fees', 'Status', ''].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {enrolled.map((e: any) => (
                  <tr key={e.id} className="border-b border-[var(--line-soft)] last:border-0">
                    <td className="px-4 py-3 font-medium text-[var(--ink)]">{e.full_name}</td>
                    <td className="px-4 py-3 text-xs text-[var(--ink-soft)]">{e.phone && String(e.phone).replace(/^233/, '0')}{e.email ? ` · ${e.email}` : ''}</td>
                    <td className="px-4 py-3">
                      <button disabled={acting === e.id} onClick={() => patch(e, { fees_paid: !e.fees_paid }, e.fees_paid ? 'Marked unpaid' : 'Full fees marked paid')}
                        className={`text-xs font-medium px-2.5 py-1 rounded-full ring-1 ring-inset transition ${e.fees_paid ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-[var(--line-soft)] text-[var(--ink-soft)] ring-[var(--line)] hover:ring-[var(--accent)]'}`}>
                        {e.fees_paid ? 'Paid in full' : 'Mark paid'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {e.status === 'completed'
                        ? <Badge tone="success">Completed</Badge>
                        : <Badge tone="neutral">Active</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        {e.status !== 'completed' ? (
                          <Button size="sm" variant="secondary" disabled={acting === e.id}
                            onClick={() => patch(e, { status: 'completed', completed_at: new Date().toISOString() }, 'Marked completed')}>
                            Mark done
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" disabled={acting === e.id}
                            onClick={() => patch(e, { status: 'active', completed_at: null }, 'Reopened')}>Reopen</Button>
                        )}
                        <button disabled={acting === e.id} onClick={() => remove(e)} className="p-1.5 text-[var(--ink-faint)] hover:text-red-500"><UserMinus size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Enroll modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} maxWidth="max-w-xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">Enroll a student</h2>
            <button onClick={() => setAddOpen(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"><X size={20} /></button>
          </div>
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search registered students..." className={inputClass + ' pl-9'} autoFocus />
          </div>
          <div className="max-h-80 overflow-y-auto -mx-2 px-2">
            {candidates.length === 0 ? (
              <p className="text-sm text-[var(--ink-faint)] text-center py-8">No matching registered students.</p>
            ) : candidates.slice(0, 40).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-[var(--line-soft)] last:border-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--ink)] truncate">{a.full_name}</div>
                  <div className="text-[11px] text-[var(--ink-faint)]">{a.course?.name || '—'} · {a.payment_status}</div>
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

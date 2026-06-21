'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, inputClass, Field } from '@/components/ui'
import Modal from '@/components/shared/Modal'
import { ClipboardList, Plus, Search, X, Users, Award, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

const PREP_STATUS = [
  { value: 'ongoing', label: 'Ongoing', tone: 'warning' as const },
  { value: 'completed', label: 'Completed', tone: 'success' as const },
]
const READINESS = [
  { value: 'on_track', label: 'On track', tone: 'success' as const },
  { value: 'needs_support', label: 'Needs support', tone: 'warning' as const },
  { value: 'at_risk', label: 'At risk', tone: 'danger' as const },
]
const FINAL = [
  { value: 'pending', label: 'Pending' },
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'not_taken', label: 'Not taken' },
]

export default function CoordinatorPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [edit, setEdit] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const d = await fetch('/api/prep').then(r => r.json()).catch(() => null)
    setData(d); setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function addStudent(enrollmentId: string) {
    setSaving(true)
    try {
      const res = await fetch('/api/prep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', enrollmentId }) }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success('Added to prep tracker'); load()
    } catch (e: any) { toast.error(e.message) } finally { setSaving(false) }
  }

  async function saveEdit() {
    setSaving(true)
    try {
      const res = await fetch('/api/prep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', ...edit }) }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success('Saved'); setEdit(null); load()
    } catch (e: any) { toast.error(e.message) } finally { setSaving(false) }
  }

  const records = data?.records || []
  const eligible = data?.eligible || []
  const filtered = records.filter((r: any) => !search || (r.student_name || '').toLowerCase().includes(search.toLowerCase()))

  const stats = {
    total: records.length,
    completed: records.filter((r: any) => r.prep_status === 'completed').length,
    atRisk: records.filter((r: any) => r.readiness === 'at_risk').length,
    passed: records.filter((r: any) => r.final_status === 'passed').length,
  }

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow={data?.myProgram ? `${data.myProgram} exam prep` : 'Exam prep'}
        title="Prep tracker"
        description="Track each student's exam preparation, readiness, scheduling and final result."
        actions={eligible.length > 0 ? <Button onClick={() => setAddOpen(true)} icon={<Plus size={15} />}>Add student ({eligible.length})</Button> : undefined}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'In prep', value: stats.total, icon: <Users size={16} /> },
          { label: 'Completed prep', value: stats.completed, icon: <ClipboardList size={16} /> },
          { label: 'At risk', value: stats.atRisk, icon: <AlertTriangle size={16} /> },
          { label: 'Passed', value: stats.passed, icon: <Award size={16} /> },
        ].map(s => (
          <Card key={s.label} className="p-4">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center mb-2">{s.icon}</div>
            <div className="font-display text-2xl font-semibold text-[var(--ink)]">{s.value}</div>
            <div className="text-xs text-[var(--ink-faint)]">{s.label}</div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-[var(--line)]">
          <div className="relative max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students..." className={inputClass + ' pl-9'} />
          </div>
        </div>

        {loading ? <div className="p-8"><Spinner /></div> : filtered.length === 0 ? (
          <EmptyState icon={<ClipboardList size={20} />} title="No students in prep yet"
            description={eligible.length > 0 ? 'Add a completed student to start tracking their exam prep.' : 'Students appear here once they complete their class.'}
            action={eligible.length > 0 ? <Button onClick={() => setAddOpen(true)}>Add a student</Button> : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  {['Student', 'Prep', 'Readiness', 'Exam date', 'Voucher expiry', 'Final', ''].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r: any) => {
                  const ps = PREP_STATUS.find(s => s.value === r.prep_status)
                  const rd = READINESS.find(s => s.value === r.readiness)
                  return (
                    <tr key={r.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--line-soft)] transition cursor-pointer" onClick={() => setEdit(r)}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--ink)]">{r.student_name}</div>
                        <div className="text-[11px] text-[var(--ink-faint)]">{r.program_name || r.program_code}</div>
                      </td>
                      <td className="px-4 py-3">{ps && <Badge tone={ps.tone}>{ps.label}</Badge>}</td>
                      <td className="px-4 py-3">{rd ? <Badge tone={rd.tone}>{rd.label}</Badge> : <span className="text-[var(--ink-faint)] text-xs">—</span>}</td>
                      <td className="px-4 py-3 text-sm text-[var(--ink-soft)]">{r.exam_scheduled_date || '—'}</td>
                      <td className="px-4 py-3 text-sm text-[var(--ink-soft)]">{r.voucher_expiry_date || '—'}</td>
                      <td className="px-4 py-3 text-sm">{r.final_status ? <span className={r.final_status === 'passed' ? 'text-[var(--ok)] font-medium' : r.final_status === 'failed' ? 'text-[var(--danger)] font-medium' : 'text-[var(--ink-soft)]'}>{FINAL.find(f => f.value === r.final_status)?.label}</span> : <span className="text-[var(--ink-faint)]">—</span>}</td>
                      <td className="px-4 py-3 text-xs text-[var(--accent)] font-medium">Edit</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add student modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} maxWidth="max-w-xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">Add student to prep</h2>
            <button onClick={() => setAddOpen(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"><X size={20} /></button>
          </div>
          <div className="max-h-80 overflow-y-auto -mx-2 px-2">
            {eligible.length === 0 ? (
              <p className="text-sm text-[var(--ink-faint)] text-center py-8">No completed students waiting.</p>
            ) : eligible.map((e: any) => (
              <div key={e.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-[var(--line-soft)] last:border-0">
                <div>
                  <div className="text-sm font-medium text-[var(--ink)]">{e.full_name}</div>
                  <div className="text-[11px] text-[var(--ink-faint)]">{e.batch?.course?.name || e.batch?.name}</div>
                </div>
                <Button size="sm" disabled={saving} onClick={() => addStudent(e.id)}>Add</Button>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* Edit record modal */}
      <Modal open={!!edit} onClose={() => setEdit(null)} maxWidth="max-w-lg">
        {edit && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-display text-xl font-semibold text-[var(--ink)]">{edit.student_name}</h2>
                <p className="text-xs text-[var(--ink-faint)]">{edit.program_name || edit.program_code}</p>
              </div>
              <button onClick={() => setEdit(null)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Prep status">
                  <select value={edit.prep_status || 'ongoing'} onChange={e => setEdit({ ...edit, prep_status: e.target.value })} className={inputClass}>
                    {PREP_STATUS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label="Readiness">
                  <select value={edit.readiness || ''} onChange={e => setEdit({ ...edit, readiness: e.target.value })} className={inputClass}>
                    <option value="">—</option>
                    {READINESS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Latest mock / practice score">
                <input value={edit.mock_score || ''} onChange={e => setEdit({ ...edit, mock_score: e.target.value })} placeholder="e.g. 72% / Above Target" className={inputClass} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Exam scheduled date">
                  <input type="date" value={edit.exam_scheduled_date || ''} onChange={e => setEdit({ ...edit, exam_scheduled_date: e.target.value })} className={inputClass} />
                </Field>
                <Field label="Voucher expiry date">
                  <input type="date" value={edit.voucher_expiry_date || ''} onChange={e => setEdit({ ...edit, voucher_expiry_date: e.target.value })} className={inputClass} />
                </Field>
              </div>
              <Field label="Final status">
                <select value={edit.final_status || ''} onChange={e => setEdit({ ...edit, final_status: e.target.value })} className={inputClass}>
                  <option value="">—</option>
                  {FINAL.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Comment">
                <textarea value={edit.comment || ''} onChange={e => setEdit({ ...edit, comment: e.target.value })} rows={3} placeholder="Notes on performance, readiness, interventions..." className={inputClass + ' resize-none'} />
              </Field>
            </div>
            <div className="flex gap-2 mt-6">
              <Button onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
              <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

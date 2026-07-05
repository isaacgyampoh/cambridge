'use client'
import { useState } from 'react'
import { useData, mutate } from '@/hooks/useData'
import type { Batch, Course, Profile } from '@/types'
import { toast } from 'sonner'
import { Plus, X, GraduationCap, Calendar, Clock, User, MapPin, Send, Users } from 'lucide-react'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import { PageHeader, Card, Button, Badge, EmptyState, Spinner, Field, inputClass } from '@/components/ui'

export default function ClassesPage() {
  const { data: batches, loading, refetch: load } = useData<Batch>({
    table: 'batches', select: '*, courses(*), trainer:profiles!trainer_id(full_name)',
    orderBy: 'start_date', orderAsc: false, limit: 200,
  })
  const { data: courses } = useData<Course>({
    table: 'courses', filters: [{ col: 'is_active', op: 'eq', val: true }], orderBy: 'name', limit: 200,
  })
  const { data: trainers } = useData<Profile>({
    table: 'profiles', filters: [{ col: 'role', op: 'eq', val: 'trainer' }, { col: 'is_active', op: 'eq', val: true }], orderBy: 'full_name', limit: 200,
  })
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [zoomEdits, setZoomEdits] = useState<Record<string, string>>({})
  const [zoomSending, setZoomSending] = useState<string | null>(null)
  const [matOpen, setMatOpen] = useState<string | null>(null)
  const [matForm, setMatForm] = useState({ title: '', link: '', note: '' })
  const [matSending, setMatSending] = useState(false)

  async function sendMaterials(batchId: string) {
    if (!matForm.link.trim() && !matForm.note.trim()) { toast.error('Add a link or a note'); return }
    setMatSending(true)
    try {
      const res = await fetch('/api/classes/materials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, ...matForm }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success(`Materials sent to ${res.sent} of ${res.total} students`)
      setMatOpen(null); setMatForm({ title: '', link: '', note: '' })
    } catch (e: any) { toast.error(e.message) }
    finally { setMatSending(false) }
  }

  async function sendZoom(batchId: string, currentLink: string) {
    const link = zoomEdits[batchId] ?? currentLink ?? ''
    if (!link.trim()) { toast.error('Enter a Zoom/meeting link first'); return }
    setZoomSending(batchId)
    try {
      const res = await fetch('/api/classes/zoom', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, zoomLink: link.trim(), send: true }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success(`Zoom link sent to ${res.sent} of ${res.total} students`)
      load()
    } catch (e: any) { toast.error(e.message) }
    finally { setZoomSending(null) }
  }

  async function saveZoomOnly(batchId: string, currentLink: string) {
    const link = zoomEdits[batchId] ?? currentLink ?? ''
    setZoomSending(batchId)
    try {
      await fetch('/api/classes/zoom', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, zoomLink: link.trim(), send: false }),
      })
      toast.success('Zoom link saved')
      load()
    } catch (e: any) { toast.error(e.message) }
    finally { setZoomSending(null) }
  }
  const [form, setForm] = useState<any>({
    name: '', course_id: '', trainer_id: '', class_type: 'physical', status: 'upcoming',
    start_date: '', end_date: '', schedule: '', venue: '', zoom_link: '', max_students: 30,
  })

  async function save() {
    if (!form.name || !form.course_id) { toast.error('Enter a name and select a course'); return }
    setSaving(true)
    try {
      await mutate('POST', 'batches', {
        ...form,
        trainer_id: form.trainer_id || null,
        zoom_link: form.zoom_link || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      })
      toast.success('Class created')
      setModal(false)
      setForm({ name: '', course_id: '', trainer_id: '', class_type: 'physical', status: 'upcoming', start_date: '', end_date: '', schedule: '', venue: '', zoom_link: '', max_students: 30 })
      load()
    } catch (e: any) {
      toast.error(e.message || 'Could not create the class')
    } finally { setSaving(false) }
  }

  async function updateStatus(id: string, status: string) {
    try { await mutate('PATCH', 'batches', { status }, [{ col: 'id', val: id }]); load() }
    catch (e: any) { toast.error(e.message || 'Could not update status') }
  }

  const STATUS_TONE: Record<string, any> = {
    upcoming: 'accent', ongoing: 'success', completed: 'muted', cancelled: 'danger',
  }

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Academics"
        title="Classes"
        description="Class batches running against your courses, with trainers, schedules and venues."
        actions={<Button onClick={() => setModal(true)} >New class</Button>}
      />

      <Modal open={modal} onClose={() => setModal(false)} maxWidth="max-w-md">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">New class</h2>
            <button onClick={() => setModal(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)] transition"></button>
          </div>
          <div className="space-y-4">
            <Field label="Class name" required>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="PMP — March 2026" className={inputClass} />
            </Field>
            <Field label="Course" required>
              <select value={form.course_id} onChange={e => setForm({ ...form, course_id: e.target.value })} className={inputClass}>
                <option value="">Select a course</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date"><input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className={inputClass} /></Field>
              <Field label="End date"><input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className={inputClass} /></Field>
            </div>
            <Field label="Schedule"><input value={form.schedule} onChange={e => setForm({ ...form, schedule: e.target.value })} placeholder="Mon / Wed / Fri, 9am–12pm" className={inputClass} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Trainer">
                <select value={form.trainer_id} onChange={e => setForm({ ...form, trainer_id: e.target.value })} className={inputClass}>
                  <option value="">Unassigned</option>
                  {trainers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
              </Field>
              <Field label="Format">
                <select value={form.class_type} onChange={e => setForm({ ...form, class_type: e.target.value })} className={inputClass}>
                  <option value="physical">In person</option>
                  <option value="online">Online</option>
                </select>
              </Field>
            </div>
            {form.class_type === 'physical'
              ? <Field label="Venue"><input value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} placeholder="Accra Campus" className={inputClass} /></Field>
              : <Field label="Meeting link"><input value={form.zoom_link} onChange={e => setForm({ ...form, zoom_link: e.target.value })} placeholder="https://…" className={inputClass} /></Field>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max students"><input type="number" value={form.max_students} onChange={e => setForm({ ...form, max_students: parseInt(e.target.value) || 0 })} className={inputClass} /></Field>
              <Field label="Status">
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className={inputClass}>
                  <option value="upcoming">Upcoming</option>
                  <option value="ongoing">Ongoing</option>
                </select>
              </Field>
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <Button onClick={save} disabled={saving} className="flex-1">{saving ? 'Creating…' : 'Create class'}</Button>
            <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {loading ? <Spinner /> : batches.length === 0 ? (
        <EmptyState
          
          title="No classes yet"
          description="Create a class batch from one of your courses to begin enrolling students."
          action={<Button onClick={() => setModal(true)} >New class</Button>}
        />
      ) : (
        <div className="space-y-3 stagger">
          {batches.map(b => {
            const course = (b as any).courses
            const trainer = (b as any).trainer
            return (
              <Card key={b.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="w-11 h-11 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center flex-shrink-0">
                      
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-display text-lg font-semibold text-[var(--ink)] leading-snug">{b.name}</h3>
                      <p className="text-sm text-[var(--ink-soft)]">{course?.name}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-xs text-[var(--ink-faint)]">
                        {b.start_date && <span className="flex items-center gap-1.5">{formatDate(b.start_date)}</span>}
                        {b.schedule && <span className="flex items-center gap-1.5">{b.schedule}</span>}
                        {trainer && <span className="flex items-center gap-1.5">{trainer.full_name}</span>}
                        {b.venue && <span className="flex items-center gap-1.5">{b.venue}</span>}
                        <Badge tone={b.class_type === 'online' ? 'accent' : 'neutral'}>{b.class_type === 'online' ? 'Online' : 'In person'}</Badge>
                      </div>
                    </div>
                  </div>
                  <select value={b.status} onChange={e => updateStatus(b.id, e.target.value)}
                    className="text-[12px] font-semibold px-2.5 py-1.5 rounded-md border border-[var(--line)] bg-white text-[var(--ink-soft)] focus:outline-none focus:border-[var(--accent)] cursor-pointer flex-shrink-0">
                    {['upcoming', 'ongoing', 'completed', 'cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {/* Zoom link — send to enrolled students */}
                {b.class_type === 'online' && (
                  <div className="mt-4 pt-4 border-t border-[var(--line-soft)]">
                    <p className="text-[13px] font-semibold text-[var(--ink-faint)] mb-2">Zoom / meeting link</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={zoomEdits[b.id] ?? b.zoom_link ?? ''}
                        onChange={e => setZoomEdits(z => ({ ...z, [b.id]: e.target.value }))}
                        placeholder="https://zoom.us/j/..."
                        className="flex-1 min-w-[200px] h-10 px-3 rounded-lg border border-[var(--line)] text-sm font-mono focus:outline-none focus:border-[var(--accent)]" />
                      <Button size="sm" variant="secondary" disabled={zoomSending === b.id} onClick={() => saveZoomOnly(b.id, b.zoom_link || '')}>Save</Button>
                      <Button size="sm" disabled={zoomSending === b.id} onClick={() => sendZoom(b.id, b.zoom_link || '')} >
                        {zoomSending === b.id ? 'Sending…' : 'Send to students'}
                      </Button>
                    </div>
                    <p className="text-[12px] text-[var(--ink-faint)] mt-1.5">Sends the link to every enrolled student by WhatsApp (SMS fallback) and email.</p>
                  </div>
                )}

                {/* Manage students */}
                <div className="mt-4 pt-4 border-t border-[var(--line-soft)]">
                  <Link href={`/admin/classes/${b.id}/students`}
                    className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent-soft)] text-[var(--accent)] rounded-lg text-sm font-medium hover:brightness-95 transition">
                     Manage students
                  </Link>
                </div>

                {/* Course materials — send to enrolled students after a session */}
                <div className="mt-4 pt-4 border-t border-[var(--line-soft)]">
                  <p className="text-[13px] font-semibold text-[var(--ink-faint)] mb-2">Course materials</p>
                  {matOpen === b.id ? (
                    <div className="space-y-2">
                      <input value={matForm.title} onChange={e => setMatForm(f => ({ ...f, title: e.target.value }))}
                        placeholder="Title (e.g. Session 3 slides)"
                        className="w-full h-10 px-3 rounded-lg border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
                      <input value={matForm.link} onChange={e => setMatForm(f => ({ ...f, link: e.target.value }))}
                        placeholder="Link to material (Google Drive, PDF, etc.)"
                        className="w-full h-10 px-3 rounded-lg border border-[var(--line)] text-sm font-mono focus:outline-none focus:border-[var(--accent)]" />
                      <textarea value={matForm.note} onChange={e => setMatForm(f => ({ ...f, note: e.target.value }))}
                        placeholder="Optional note to students..." rows={2}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--line)] text-sm resize-none focus:outline-none focus:border-[var(--accent)]" />
                      <div className="flex gap-2">
                        <Button size="sm" disabled={matSending} onClick={() => sendMaterials(b.id)} >
                          {matSending ? 'Sending…' : 'Send to students'}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => { setMatOpen(null); setMatForm({ title: '', link: '', note: '' }) }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setMatOpen(b.id)} >Send course materials</Button>
                  )}
                  <p className="text-[12px] text-[var(--ink-faint)] mt-1.5">Shares materials with every enrolled student by WhatsApp (SMS fallback) and email.</p>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

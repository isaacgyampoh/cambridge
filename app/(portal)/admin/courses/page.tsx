'use client'
import { useState } from 'react'
import { useData, mutate } from '@/hooks/useData'
import FileUpload from '@/components/shared/FileUpload'
import type { Course } from '@/types'
import { toast } from 'sonner'
import { Plus, X, BookOpen, Pencil } from 'lucide-react'
import Modal from '@/components/shared/Modal'
import { PageHeader, Card, Button, Badge, EmptyState, Spinner, Field, inputClass } from '@/components/ui'

export default function CoursesPage() {
  const { data: courses, loading, refetch: load } = useData<Course>({ table: 'courses', orderBy: 'name', limit: 200 })
  const [modal, setModal] = useState<'new' | 'edit' | null>(null)
  const [editing, setEditing] = useState<Partial<Course> | null>(null)
  const [saving, setSaving] = useState(false)

  function openNew() {
    setEditing({ name: '', code: '', description: '', duration: '', course_fee: 0, course_fee_online: 0, registration_fee: 200, is_active: true })
    setModal('new')
  }
  function openEdit(c: Course) { setEditing({ ...c }); setModal('edit') }

  async function save() {
    if (!editing?.name) { toast.error('Enter a course name'); return }
    setSaving(true)
    try {
      const { id, ...data } = editing as any
      if (modal === 'new') await mutate('POST', 'courses', data)
      else await mutate('PATCH', 'courses', data, [{ col: 'id', val: id }])
      toast.success(modal === 'new' ? 'Course created' : 'Course updated')
      setModal(null); setEditing(null); load()
    } catch (e: any) {
      toast.error(e.message || 'Could not save the course')
    } finally { setSaving(false) }
  }

  async function toggle(id: string, active: boolean) {
    try { await mutate('PATCH', 'courses', { is_active: !active }, [{ col: 'id', val: id }]); load() }
    catch (e: any) { toast.error(e.message || 'Could not update') }
  }

  const fields = [
    { key: 'name', label: 'Course name', placeholder: 'Project Management Professional', type: 'text', required: true },
    { key: 'code', label: 'Code', placeholder: 'PMP-001', type: 'text' },
    { key: 'duration', label: 'Duration', placeholder: '3 months', type: 'text' },
    { key: 'course_fee', label: 'Course fee — in person (GHS)', placeholder: '4950', type: 'number' },
    { key: 'course_fee_online', label: 'Course fee — online (GHS)', placeholder: '3950', type: 'number' },
    { key: 'registration_fee', label: 'Registration fee (GHS)', placeholder: '200', type: 'number' },
  ]

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Academics"
        title="Courses"
        description="Your programme catalogue. Fees set here flow through to admissions and invoicing."
        actions={<Button onClick={openNew} icon={<Plus size={15} />}>Add course</Button>}
      />

      <Modal open={!!(modal && editing)} onClose={() => { setModal(null); setEditing(null) }} maxWidth="max-w-md">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">{modal === 'new' ? 'New course' : 'Edit course'}</h2>
            <button onClick={() => { setModal(null); setEditing(null) }} className="text-[var(--ink-faint)] hover:text-[var(--ink)] transition"><X size={20} /></button>
          </div>
          <div className="space-y-4">
            {fields.map(f => (
              <Field key={f.key} label={f.label} required={f.required}>
                <input type={f.type} placeholder={f.placeholder}
                  value={(editing as any)?.[f.key] ?? ''}
                  onChange={e => setEditing({ ...editing, [f.key]: f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value })}
                  className={inputClass} />
              </Field>
            ))}
            <Field label="Description">
              <textarea value={(editing as any)?.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={3}
                className={inputClass.replace('h-11', 'min-h-[80px] py-3')} />
            </Field>
            <Field label="Brochure (PDF)">
              <FileUpload onUploaded={url => setEditing({ ...editing, brochure_url: url })} value={(editing as any)?.brochure_url} label="Upload course brochure" accept="application/pdf" folder="cce/brochures" />
              <p className="text-[11px] text-[var(--ink-faint)] mt-1.5">The AI sends this brochure to leads interested in this course, alongside its reply.</p>
            </Field>
          </div>
          <div className="flex gap-2 mt-6">
            <Button onClick={save} disabled={saving} className="flex-1">{saving ? 'Saving…' : 'Save course'}</Button>
            <Button variant="secondary" onClick={() => { setModal(null); setEditing(null) }}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {loading ? <Spinner /> : courses.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={22} />}
          title="No courses yet"
          description="Add your first programme to start building your catalogue."
          action={<Button onClick={openNew} icon={<Plus size={15} />}>Add course</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
          {courses.map(c => (
            <Card key={c.id} className={`p-5 ${!c.is_active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center">
                  <BookOpen size={18} className="text-[var(--accent)]" />
                </div>
                <Badge tone={c.is_active ? 'success' : 'muted'}>{c.is_active ? 'Active' : 'Inactive'}</Badge>
              </div>
              <h3 className="font-display text-lg font-semibold text-[var(--ink)] leading-snug">{c.name}</h3>
              {c.code && <p className="text-xs text-[var(--ink-faint)] font-mono mt-0.5">{c.code}</p>}
              {c.description && <p className="text-sm text-[var(--ink-soft)] mt-2 line-clamp-2">{c.description}</p>}

              <div className="mt-4 pt-4 border-t border-[var(--line-soft)] space-y-1.5 text-sm">
                {c.duration && (
                  <div className="flex justify-between"><span className="text-[var(--ink-faint)]">Duration</span><span className="font-medium text-[var(--ink)]">{c.duration}</span></div>
                )}
                <div className="flex justify-between"><span className="text-[var(--ink-faint)]">Course fee</span><span className="font-semibold text-[var(--ink)]">GHS {Number(c.course_fee || 0).toLocaleString()}</span></div>
                {Number(c.course_fee_online) > 0 && <div className="flex justify-between"><span className="text-[var(--ink-faint)]">Online fee</span><span className="font-medium text-[var(--ink)]">GHS {Number(c.course_fee_online).toLocaleString()}</span></div>}
                <div className="flex justify-between"><span className="text-[var(--ink-faint)]">Registration</span><span className="font-medium text-[var(--ink)]">GHS {Number(c.registration_fee || 0).toLocaleString()}</span></div>
              </div>

              <div className="flex gap-2 mt-4">
                <Button variant="secondary" size="sm" onClick={() => openEdit(c)} icon={<Pencil size={13} />} className="flex-1">Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => toggle(c.id, c.is_active)}>{c.is_active ? 'Disable' : 'Enable'}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

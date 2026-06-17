'use client'
import { useState } from 'react'
import { useData, mutate, mutateDelete } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, inputClass, Field } from '@/components/ui'
import Modal from '@/components/shared/Modal'
import { Quote, Plus, X, Check, Share2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

export default function TestimonialsPage() {
  const { data: items, loading, refetch } = useData<any>({ table: 'testimonials', select: '*', orderBy: 'created_at', orderAsc: false, limit: 500 })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ student_name: '', program_name: '', quote: '', image_url: '' })
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!form.student_name.trim() || !form.quote.trim()) { toast.error('Add the student name and their testimonial'); return }
    setSaving(true)
    try {
      await mutate('POST', 'testimonials', { ...form })
      toast.success('Testimonial saved'); setForm({ student_name: '', program_name: '', quote: '', image_url: '' }); setOpen(false); refetch()
    } catch (e: any) { toast.error(e.message) } finally { setSaving(false) }
  }

  async function toggle(t: any, field: string) {
    try { await mutate('PATCH', 'testimonials', { [field]: !t[field] }, [{ col: 'id', val: t.id }]); refetch() }
    catch { toast.error('Failed') }
  }

  async function remove(id: string) {
    if (!confirm('Delete this testimonial?')) return
    try { await mutateDelete('testimonials', [{ col: 'id', val: id }]); toast.success('Deleted'); refetch() }
    catch { toast.error('Failed') }
  }

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Visibility"
        title="Testimonials"
        description="Collect student testimonials and images to share on the Institute's socials."
        actions={<Button onClick={() => setOpen(true)} icon={<Plus size={15} />}>Add testimonial</Button>}
      />

      {loading ? <Spinner /> : items.length === 0 ? (
        <EmptyState icon={<Quote size={20} />} title="No testimonials yet"
          description="Gather a student's words and photo to feature on social media."
          action={<Button onClick={() => setOpen(true)}>Add the first one</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((t: any) => (
            <Card key={t.id} className="p-5 flex flex-col">
              <div className="flex items-start gap-3 mb-3">
                {t.image_url ? (
                  <img src={t.image_url} alt={t.student_name} className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center font-semibold">{(t.student_name || '?')[0]}</div>
                )}
                <div className="min-w-0">
                  <div className="font-medium text-[var(--ink)] truncate">{t.student_name}</div>
                  {t.program_name && <div className="text-[11px] text-[var(--ink-faint)]">{t.program_name}</div>}
                </div>
              </div>
              <p className="text-sm text-[var(--ink-soft)] flex-1 mb-3">"{t.quote}"</p>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => toggle(t, 'approved')} className={`text-[11px] font-medium px-2.5 py-1 rounded-full ring-1 ring-inset transition ${t.approved ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-[var(--line-soft)] text-[var(--ink-soft)] ring-[var(--line)]'}`}>{t.approved ? 'Approved' : 'Approve'}</button>
                <button onClick={() => toggle(t, 'shared')} className={`text-[11px] font-medium px-2.5 py-1 rounded-full ring-1 ring-inset transition ${t.shared ? 'bg-[var(--accent-soft)] text-[var(--accent)] ring-[var(--accent)]/20' : 'bg-[var(--line-soft)] text-[var(--ink-soft)] ring-[var(--line)]'}`}>{t.shared ? 'Shared' : 'Mark shared'}</button>
                <button onClick={() => remove(t.id)} className="ml-auto p-1.5 text-[var(--ink-faint)] hover:text-red-500"><Trash2 size={14} /></button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} maxWidth="max-w-lg">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">Add testimonial</h2>
            <button onClick={() => setOpen(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"><X size={20} /></button>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Student name" required>
                <input value={form.student_name} onChange={e => setForm(f => ({ ...f, student_name: e.target.value }))} className={inputClass} />
              </Field>
              <Field label="Programme">
                <input value={form.program_name} onChange={e => setForm(f => ({ ...f, program_name: e.target.value }))} placeholder="e.g. PMP" className={inputClass} />
              </Field>
            </div>
            <Field label="Testimonial" required>
              <textarea value={form.quote} onChange={e => setForm(f => ({ ...f, quote: e.target.value }))} rows={3} placeholder="What the student said..." className={inputClass + ' resize-none'} />
            </Field>
            <Field label="Image link">
              <input value={form.image_url} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} placeholder="Paste an image URL (Drive, etc.)" className={inputClass} />
            </Field>
          </div>
          <div className="flex gap-2 mt-6">
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save testimonial'}</Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

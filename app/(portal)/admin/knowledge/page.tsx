'use client'
import { useState } from 'react'
import { useData, mutate, mutateDelete } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, Field, inputClass, SectionLabel, textareaClass} from '@/components/ui'
import { Plus, X, MessageCircleQuestion, Info, Pencil, Trash2, Sparkles } from 'lucide-react'
import Modal from '@/components/shared/Modal'
import { toast } from 'sonner'

export default function KnowledgeBasePage() {
  const { data: entries, loading, refetch } = useData<any>({
    table: 'knowledge_base', orderBy: 'sort_order', orderAsc: true, limit: 500,
  })
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ kind: 'faq', category: '', question: '', answer: '', is_active: true })

  function openNew(kind: 'faq' | 'info') {
    setEditing(null)
    setForm({ kind, category: '', question: '', answer: '', is_active: true })
    setModal(true)
  }
  function openEdit(e: any) {
    setEditing(e)
    setForm({ kind: e.kind, category: e.category || '', question: e.question || '', answer: e.answer || '', is_active: e.is_active })
    setModal(true)
  }

  async function save() {
    if (!form.answer.trim()) { toast.error('Enter the answer / information'); return }
    if (form.kind === 'faq' && !form.question.trim()) { toast.error('Enter the question'); return }
    setSaving(true)
    try {
      const payload = { ...form, updated_at: new Date().toISOString() }
      if (editing) await mutate('PATCH', 'knowledge_base', payload, [{ col: 'id', val: editing.id }])
      else await mutate('POST', 'knowledge_base', payload)
      toast.success(editing ? 'Updated' : 'Added to knowledge base')
      setModal(false); refetch()
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  async function toggle(e: any) {
    try { await mutate('PATCH', 'knowledge_base', { is_active: !e.is_active }, [{ col: 'id', val: e.id }]); refetch() }
    catch (err: any) { toast.error(err.message) }
  }
  async function del(id: string) {
    if (!confirm('Delete this entry?')) return
    try { await mutateDelete('knowledge_base', [{ col: 'id', val: id }]); refetch() }
    catch (e: any) { toast.error(e.message) }
  }

  const faqs = entries.filter((e: any) => e.kind === 'faq')
  const infos = entries.filter((e: any) => e.kind === 'info')

  return (
    <div className="fade-in w-full max-w-4xl mx-auto">
      <PageHeader
        eyebrow="AI Assistant"
        title="Knowledge base"
        description="The facts your WhatsApp assistant uses to answer leads. Add FAQs and centre information here — the assistant only answers from what you provide."
        actions={
          <>
            <Button variant="secondary" onClick={() => openNew('info')} icon={<Info size={14} />}>Add info</Button>
            <Button onClick={() => openNew('faq')} icon={<Plus size={15} />}>Add FAQ</Button>
          </>
        }
      />

      <Card className="p-4 mb-8 bg-[var(--accent-soft)] border-[var(--accent-soft)]">
        <div className="flex items-start gap-3">
          <Sparkles size={18} className="text-[var(--accent)] flex-shrink-0 mt-0.5" />
          <div className="text-sm text-[var(--accent)]">
            <strong>How the assistant works:</strong> when a lead messages a marketer on WhatsApp and no one replies, the assistant answers in that marketer's voice using only these entries. If something isn't covered here, it won't make things up — it tells the lead the marketer will call them with details. Keep these accurate and up to date.
          </div>
        </div>
      </Card>

      {loading ? <Spinner /> : (
        <>
          {/* FAQs */}
          <SectionLabel>Frequently asked questions ({faqs.length})</SectionLabel>
          {faqs.length === 0 ? (
            <EmptyState icon={<MessageCircleQuestion size={20} />} title="No FAQs yet" description="Add the questions leads commonly ask — fees, schedule, location, requirements." action={<Button onClick={() => openNew('faq')}>Add FAQ</Button>} />
          ) : (
            <div className="space-y-2 mb-10 stagger">
              {faqs.map((e: any) => (
                <Card key={e.id} className={`p-4 ${!e.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {e.category && <Badge tone="neutral">{e.category}</Badge>}
                        {!e.is_active && <Badge tone="muted">Off</Badge>}
                      </div>
                      <div className="font-medium text-[var(--ink)] text-sm">{e.question}</div>
                      <div className="text-sm text-[var(--ink-soft)] mt-1 whitespace-pre-line">{e.answer}</div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => toggle(e)} className="text-xs font-medium px-2 py-1 rounded-md text-[var(--ink-soft)] hover:bg-[var(--line-soft)]">{e.is_active ? 'Disable' : 'Enable'}</button>
                      <button onClick={() => openEdit(e)} className="p-1.5 rounded-md text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--line-soft)]"><Pencil size={14} /></button>
                      <button onClick={() => del(e.id)} className="p-1.5 rounded-md text-[var(--ink-faint)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)]"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Centre info */}
          <SectionLabel>Centre information ({infos.length})</SectionLabel>
          {infos.length === 0 ? (
            <EmptyState icon={<Info size={20} />} title="No info snippets yet" description="Add general facts: address, opening hours, payment options, contact details." action={<Button variant="secondary" onClick={() => openNew('info')}>Add info</Button>} />
          ) : (
            <div className="space-y-2 stagger">
              {infos.map((e: any) => (
                <Card key={e.id} className={`p-4 ${!e.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {e.category && <Badge tone="accent">{e.category}</Badge>}
                        {!e.is_active && <Badge tone="muted">Off</Badge>}
                      </div>
                      <div className="text-sm text-[var(--ink)] whitespace-pre-line">{e.answer}</div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => toggle(e)} className="text-xs font-medium px-2 py-1 rounded-md text-[var(--ink-soft)] hover:bg-[var(--line-soft)]">{e.is_active ? 'Disable' : 'Enable'}</button>
                      <button onClick={() => openEdit(e)} className="p-1.5 rounded-md text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--line-soft)]"><Pencil size={14} /></button>
                      <button onClick={() => del(e.id)} className="p-1.5 rounded-md text-[var(--ink-faint)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)]"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={modal} onClose={() => setModal(false)} maxWidth="max-w-lg">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">
              {editing ? 'Edit entry' : form.kind === 'faq' ? 'New FAQ' : 'New info'}
            </h2>
            <button onClick={() => setModal(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"><X size={20} /></button>
          </div>
          <div className="space-y-4">
            <Field label="Category" hint="optional, e.g. Fees / Schedule">
              <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Fees" className={inputClass} />
            </Field>
            {form.kind === 'faq' && (
              <Field label="Question" required>
                <input value={form.question} onChange={e => setForm({ ...form, question: e.target.value })} placeholder="How much is the Project Management course?" className={inputClass} />
              </Field>
            )}
            <Field label={form.kind === 'faq' ? 'Answer' : 'Information'} required>
              <textarea value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} rows={4}
                placeholder={form.kind === 'faq' ? 'The Project Management course is GHS 2,000, payable in two instalments...' : 'We are located at... Open Monday to Friday, 8am–5pm...'}
                className={textareaClass} />
            </Field>
          </div>
          <div className="flex gap-2 mt-6">
            <Button onClick={save} disabled={saving} className="flex-1">{saving ? 'Saving…' : 'Save'}</Button>
            <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

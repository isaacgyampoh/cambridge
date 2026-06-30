'use client'
import { useState } from 'react'
import { useData, mutate, mutateDelete } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, SectionLabel, Field, inputClass } from '@/components/ui'
import { Plus, Trash2, MessageSquare, Clock, Zap, X, GripVertical } from 'lucide-react'
import Modal from '@/components/shared/Modal'
import { toast } from 'sonner'

const TRIGGERS: Record<string, string> = {
  manual: 'Added manually',
  new_lead: 'When a new lead arrives',
  no_response: 'When a lead goes quiet',
  status_change: 'On status change',
}

export default function SequencesPage() {
  const { data: sequences, loading, refetch } = useData<any>({ table: 'sequences', orderBy: 'created_at', orderAsc: false, limit: 50 })
  const { data: allSteps, refetch: refetchSteps } = useData<any>({ table: 'sequence_steps', orderBy: 'step_order', limit: 300 })
  const [editing, setEditing] = useState<any>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState('manual')
  const [steps, setSteps] = useState<any[]>([])
  const [saving, setSaving] = useState(false)

  function openNew() {
    setEditing(null); setName(''); setTrigger('manual')
    setSteps([{ step_order: 0, delay_hours: 0, channel: 'whatsapp', message: '' }])
    setCreating(true)
  }

  function openEdit(seq: any) {
    setEditing(seq); setName(seq.name); setTrigger(seq.trigger)
    const mine = allSteps.filter((s: any) => s.sequence_id === seq.id).sort((a: any, b: any) => a.step_order - b.step_order)
    setSteps(mine.length ? mine.map((s: any) => ({ ...s })) : [{ step_order: 0, delay_hours: 0, channel: 'whatsapp', message: '' }])
    setCreating(true)
  }

  function addStep() {
    setSteps(s => [...s, { step_order: s.length, delay_hours: 24, channel: 'whatsapp', message: '' }])
  }
  function removeStep(i: number) {
    setSteps(s => s.filter((_, idx) => idx !== i).map((st, idx) => ({ ...st, step_order: idx })))
  }
  function updateStep(i: number, key: string, val: any) {
    setSteps(s => s.map((st, idx) => idx === i ? { ...st, [key]: val } : st))
  }

  async function save() {
    if (!name.trim()) { toast.error('Name your sequence'); return }
    if (steps.some(s => !s.message.trim())) { toast.error('Every step needs a message'); return }
    setSaving(true)
    try {
      let seqId = editing?.id
      if (editing) {
        await mutate('PATCH', 'sequences', { name, trigger }, [{ col: 'id', val: editing.id }])
        // wipe old steps, re-insert
        const old = allSteps.filter((s: any) => s.sequence_id === editing.id)
        for (const o of old) await mutateDelete('sequence_steps', [{ col: 'id', val: o.id }])
      } else {
        const res = await mutate('POST', 'sequences', { name, trigger, is_active: true })
        seqId = res?.[0]?.id
      }
      // insert steps
      for (let i = 0; i < steps.length; i++) {
        await mutate('POST', 'sequence_steps', {
          sequence_id: seqId, step_order: i,
          delay_hours: Number(steps[i].delay_hours) || 0,
          channel: steps[i].channel, message: steps[i].message,
        })
      }
      toast.success(editing ? 'Sequence updated' : 'Sequence created')
      setCreating(false); refetch(); refetchSteps()
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  async function toggleActive(seq: any) {
    await mutate('PATCH', 'sequences', { is_active: !seq.is_active }, [{ col: 'id', val: seq.id }])
    refetch()
  }
  async function remove(seq: any) {
    if (!confirm(`Delete "${seq.name}"? Enrolled leads will stop receiving it.`)) return
    await mutateDelete('sequences', [{ col: 'id', val: seq.id }])
    toast.success('Deleted'); refetch()
  }

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Automation"
        title="Follow-up sequences"
        description="Automated message series that nurture leads over days — sent on each lead's own WhatsApp line, in their marketer's voice."
        actions={<Button onClick={openNew} >New sequence</Button>}
      />

      {loading ? <Spinner /> : sequences.length === 0 ? (
        <EmptyState  title="No sequences yet"
          description="Build a drip series to automatically follow up with leads who go quiet."
          action={<Button onClick={openNew}>Create your first sequence</Button>} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sequences.map((seq: any) => {
            const seqSteps = allSteps.filter((s: any) => s.sequence_id === seq.id)
            return (
              <Card key={seq.id} className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-semibold text-[var(--ink)]">{seq.name}</div>
                    <div className="text-xs text-[var(--ink-faint)] mt-0.5">{TRIGGERS[seq.trigger] || seq.trigger}</div>
                  </div>
                  <button onClick={() => toggleActive(seq)}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${seq.is_active ? 'bg-[var(--accent)]' : 'bg-[var(--line)]'}`}>
                    <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${seq.is_active ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <Badge tone="neutral">{seqSteps.length} step{seqSteps.length === 1 ? '' : 's'}</Badge>
                  <Badge tone={seq.is_active ? 'success' : 'muted'}>{seq.is_active ? 'Active' : 'Paused'}</Badge>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(seq)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(seq)} >Delete</Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Builder modal */}
      <Modal open={creating} onClose={() => setCreating(false)} maxWidth="max-w-2xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">{editing ? 'Edit sequence' : 'New sequence'}</h2>
            <button onClick={() => setCreating(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"></button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            <Field label="Sequence name" required>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 3-day nurture" className={inputClass} />
            </Field>
            <Field label="When to start">
              <select value={trigger} onChange={e => setTrigger(e.target.value)} className={inputClass}>
                {Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>

          <SectionLabel>Steps</SectionLabel>
          <div className="space-y-3 mb-4">
            {steps.map((st, i) => (
              <div key={i} className="rounded-xl border border-[var(--line)] p-4 bg-[var(--canvas)]">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
                    <span className="w-6 h-6 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center text-xs font-semibold">{i + 1}</span>
                    Step {i + 1}
                  </div>
                  {steps.length > 1 && (
                    <button onClick={() => removeStep(i)} className="text-[var(--ink-faint)] hover:text-[var(--danger)]"></button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-wide">{i === 0 ? 'Send after (hours)' : 'Wait after previous (hours)'}</label>
                    <input type="number" min={0} value={st.delay_hours} onChange={e => updateStep(i, 'delay_hours', e.target.value)}
                      className={inputClass + ' mt-1'} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-wide">Channel</label>
                    <select value={st.channel} onChange={e => updateStep(i, 'channel', e.target.value)} className={inputClass + ' mt-1'}>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="sms">SMS</option>
                    </select>
                  </div>
                </div>
                <textarea value={st.message} onChange={e => updateStep(i, 'message', e.target.value)} rows={3}
                  placeholder="Hi {name}, just checking in..." className={inputClass + ' resize-none h-auto py-2.5'} />
                <p className="text-[12px] text-[var(--ink-faint)] mt-1">Use {'{name}'} for the lead's first name.</p>
              </div>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={addStep} >Add step</Button>

          <div className="flex gap-2 mt-6 pt-5 border-t border-[var(--line)]">
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create sequence'}</Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

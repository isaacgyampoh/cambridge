'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Spinner, EmptyState, inputClass, Field } from '@/components/ui'
import { toast } from 'sonner'

const KINDS = [
  { value: 'tip', label: 'Exam tip', emoji: '💡' },
  { value: 'question', label: 'Practice question', emoji: '📝' },
  { value: 'exam_info', label: 'Exam information', emoji: 'ℹ️' },
  { value: 'encouragement', label: 'Encouragement', emoji: '🌟' },
]

export default function PrepContentPage() {
  const [program, setProgram] = useState('PMP')
  const [programs, setPrograms] = useState<{ code: string; name: string }[]>([{ code: 'PMP', name: 'PMP' }])
  const [content, setContent] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ kind: 'tip', title: '', content: '', answer: '', send_offset_days: '' })
  const [saving, setSaving] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)

  useEffect(() => {
    // Figure out which programmes this coordinator runs
    fetch('/api/auth/me').then(r => r.json()).then(s => {
      const cp = s.coordinator_program
      if (s.role === 'super_admin' || s.role === 'administrator') {
        setPrograms([{ code: 'PMP', name: 'PMP' }, { code: 'PHRI', name: 'PHRi' }, { code: 'SPHRI', name: 'SPHRi' }])
      } else if (cp === 'HR') {
        setPrograms([{ code: 'PHRI', name: 'PHRi' }, { code: 'SPHRI', name: 'SPHRi' }]); setProgram('PHRI')
      } else if (cp) {
        setPrograms([{ code: cp, name: cp }]); setProgram(cp)
      }
    }).catch(() => {})
  }, [])

  async function load() {
    setLoading(true)
    const d = await fetch(`/api/prep/content?program_code=${program}`).then(r => r.json()).catch(() => ({ content: [] }))
    setContent(d.content || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [program])

  async function create() {
    if (!form.content.trim()) { toast.error('Add the content'); return }
    setSaving(true)
    const d = await fetch('/api/prep/content', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create', program_code: program, kind: form.kind,
        title: form.title || null, content: form.content, answer: form.answer || null,
        send_offset_days: form.send_offset_days ? Number(form.send_offset_days) : null,
      }),
    }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    setSaving(false)
    if (d.success) { toast.success('Saved to content bank'); setForm({ kind: 'tip', title: '', content: '', answer: '', send_offset_days: '' }); load() }
    else toast.error(d.error || 'Could not save')
  }

  async function send(id: string) {
    setSendingId(id)
    const d = await fetch('/api/prep/content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', id }) }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    setSendingId(null)
    if (d.success) toast.success(`Sent to ${d.sent} of ${d.total} students`)
    else toast.error(d.error || 'Could not send')
  }

  async function remove(id: string) {
    if (!confirm('Remove this from the content bank?')) return
    await fetch('/api/prep/content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    toast.success('Removed'); load()
  }

  return (
    <div className="fade-in w-full max-w-4xl">
      <PageHeader eyebrow="Exam prep" title="Content bank"
        description="Build tips, practice questions, and exam info. Send them to your students now, or schedule them to auto-send before their exam." />

      {programs.length > 1 && (
        <div className="flex gap-1 mb-5 bg-[var(--line-soft)] rounded-xl p-1 w-fit">
          {programs.map(p => (
            <button key={p.code} onClick={() => setProgram(p.code)}
              className={`px-4 py-2 rounded-lg text-[14px] font-medium transition ${program === p.code ? 'bg-[var(--paper)] text-[var(--ink)] shadow-sm' : 'text-[var(--ink-soft)]'}`}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Add form */}
      <Card className="p-6 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Field label="Type">
            <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} className={inputClass}>
              {KINDS.map(k => <option key={k.value} value={k.value}>{k.emoji} {k.label}</option>)}
            </select>
          </Field>
          <Field label="Auto-send (days before exam) — optional">
            <input type="number" value={form.send_offset_days} onChange={e => setForm(f => ({ ...f, send_offset_days: e.target.value }))} placeholder="e.g. 7 — leave blank for manual only" className={inputClass} />
          </Field>
        </div>
        {(form.kind === 'exam_info' || form.kind === 'question') && (
          <Field label="Title (optional)">
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder={form.kind === 'exam_info' ? 'e.g. PMP exam format' : 'e.g. Question 1'} className={inputClass} />
          </Field>
        )}
        <Field label={form.kind === 'question' ? 'Question' : 'Message'}>
          <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} rows={3}
            placeholder={form.kind === 'question' ? 'Type the practice question…' : form.kind === 'exam_info' ? 'e.g. 200 questions, 4 hours, pass mark 61%. Bring your national ID.' : 'Type the tip or message…'}
            className={inputClass + ' resize-none'} />
        </Field>
        {form.kind === 'question' && (
          <Field label="Answer (optional)">
            <input value={form.answer} onChange={e => setForm(f => ({ ...f, answer: e.target.value }))} placeholder="The correct answer / explanation" className={inputClass} />
          </Field>
        )}
        <Button onClick={create} disabled={saving} className="mt-2">{saving ? 'Saving…' : 'Add to bank'}</Button>
      </Card>

      {/* List */}
      {loading ? <Spinner /> : content.length === 0 ? (
        <EmptyState title="Nothing here yet" description="Add your first tip, question, or exam info above." />
      ) : (
        <div className="space-y-3">
          {content.map((c: any) => {
            const k = KINDS.find(x => x.value === c.kind)
            return (
              <Card key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12px] font-semibold text-[var(--accent)]">{k?.emoji} {k?.label}</span>
                      {c.send_offset_days != null && <span className="text-[11px] text-[var(--ink-faint)]">· auto-sends {c.send_offset_days}d before exam</span>}
                    </div>
                    {c.title && <div className="text-[14px] font-medium text-[var(--ink)]">{c.title}</div>}
                    <div className="text-[13px] text-[var(--ink-soft)] whitespace-pre-wrap">{c.body}</div>
                    {c.answer && <div className="text-[12px] text-[var(--ok)] mt-1">Answer: {c.answer}</div>}
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <button onClick={() => send(c.id)} disabled={sendingId === c.id}
                      className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:brightness-110 disabled:opacity-50 transition">
                      {sendingId === c.id ? 'Sending…' : 'Send now'}
                    </button>
                    <button onClick={() => remove(c.id)} className="text-[12px] text-[var(--ink-faint)] hover:text-[var(--danger)] px-3 py-1">Remove</button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Field, inputClass, textareaClass, Spinner, EmptyState, Badge } from '@/components/ui'
import { toast } from 'sonner'

export default function ClassReminders() {
  const [batches, setBatches] = useState<any[]>([])
  const [reminders, setReminders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [form, setForm] = useState({ batch_id: '', class_at: '', notify_at: '', channels: ['sms', 'whatsapp'], note: '' })

  async function load() {
    const d = await fetch('/api/class-reminders').then(r => r.json())
    setBatches(d.batches || []); setReminders(d.reminders || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!form.batch_id) { setPreview(null); return }
    const t = setTimeout(async () => {
      const d = await fetch('/api/class-reminders/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: form.batch_id, class_at: form.class_at, note: form.note }),
      }).then(r => r.json())
      setPreview(d)
    }, 400)
    return () => clearTimeout(t)
  }, [form.batch_id, form.class_at, form.note])

  function set(k: string, v: any) { setForm(f => ({ ...f, [k]: v })) }
  function toggleChannel(c: string) {
    setForm(f => ({ ...f, channels: f.channels.includes(c) ? f.channels.filter(x => x !== c) : [...f.channels, c] }))
  }

  async function create() {
    if (!form.batch_id || !form.class_at || !form.notify_at) { toast.error('Pick a class, class time and reminder time.'); return }
    setSaving(true)
    const d = await fetch('/api/class-reminders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, channels: form.channels.join(',') }),
    }).then(r => r.json())
    setSaving(false)
    if (d.reminder) { toast.success('Reminder scheduled. It will send automatically.'); setForm({ batch_id: '', class_at: '', notify_at: '', channels: ['sms', 'whatsapp'], note: '' }); load() }
    else toast.error(d.error || 'Could not schedule.')
  }

  async function act(id: string, action: string, title: string) {
    if (action === 'send_now' && !confirm(`Send the ${title} reminder to all enrolled students now?`)) return
    if (action === 'cancel' && !confirm('Cancel this reminder?')) return
    if (action === 'send_now') toast.loading('Sending…', { id: 'cr' })
    const d = await fetch('/api/class-reminders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) }).then(r => r.json())
    if (action === 'send_now') {
      if (d.success) toast.success(`Sent to ${d.students_notified} students`, { id: 'cr' })
      else toast.error(d.error || 'Could not send', { id: 'cr' })
    } else toast.success('Cancelled')
    load()
  }

  return (
    <div className="fade-in w-full">
      <PageHeader eyebrow="Automation" title="Class reminders"
        description="Schedule a reminder for a class. At the send time, the system automatically texts and WhatsApps the Zoom link to every enrolled student." />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        <div>
          {loading ? <Spinner /> : reminders.length === 0 ? (
            <EmptyState title="No class reminders yet" description="Schedule your first one on the right — students get the Zoom link automatically at the time you set." />
          ) : (
            <div className="space-y-3">
              {reminders.map(r => {
                const when = new Date(r.class_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                const send = new Date(r.notify_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                return (
                  <Card key={r.id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-display text-[16px] font-semibold text-[var(--ink)]">{r.batch?.name || 'Class'}</h3>
                          <Badge tone={r.status === 'sent' ? 'success' : r.status === 'cancelled' ? 'danger' : 'accent'}>{r.status}</Badge>
                        </div>
                        <p className="text-[13px] text-[var(--ink-soft)] mt-1">Class: {when}</p>
                        {r.status === 'scheduled' && <p className="text-[13px] text-[var(--ink-faint)]">Reminder sends: {send}</p>}
                        {r.status === 'sent' && <p className="text-[13px] text-[var(--ok)]">Sent to {r.students_notified} students</p>}
                      </div>
                      {r.status === 'scheduled' && (
                        <div className="flex flex-col gap-2 flex-shrink-0">
                          <button onClick={() => act(r.id, 'send_now', r.batch?.name)} className="text-[13px] text-white bg-[var(--accent)] px-3 py-1.5 rounded-lg font-semibold hover:brightness-110">Send now</button>
                          <button onClick={() => act(r.id, 'cancel', '')} className="text-[13px] text-[var(--danger)] font-medium">Cancel</button>
                        </div>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        <Card className="p-6">
          <h3 className="font-display text-[16px] font-semibold text-[var(--ink)] mb-4">Schedule a reminder</h3>
          {batches.length === 0 ? (
            <p className="text-[14px] text-[var(--ink-soft)]">No active classes with a Zoom link. Add a Zoom link to a class first.</p>
          ) : (
            <div className="space-y-4">
              <Field label="Class">
                <select className={inputClass} value={form.batch_id} onChange={e => set('batch_id', e.target.value)}>
                  <option value="">Select a class…</option>
                  {batches.map(b => <option key={b.id} value={b.id} disabled={!b.zoom_link}>{b.name}{!b.zoom_link ? ' (no Zoom link)' : ''}</option>)}
                </select>
              </Field>
              <Field label="When is the class?"><input type="datetime-local" className={inputClass} value={form.class_at} onChange={e => set('class_at', e.target.value)} /></Field>
              <Field label="When to send the reminder?"><input type="datetime-local" className={inputClass} value={form.notify_at} onChange={e => set('notify_at', e.target.value)} /></Field>
              <Field label="Note (optional)"><textarea className={textareaClass} rows={2} placeholder="Have your materials ready." value={form.note} onChange={e => set('note', e.target.value)} /></Field>
              <div>
                <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-2">Send by</label>
                <div className="flex gap-2">
                  {['sms', 'whatsapp'].map(c => (
                    <button key={c} onClick={() => toggleChannel(c)}
                      className={`flex-1 h-10 rounded-xl text-[13px] font-semibold border transition ${form.channels.includes(c) ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/30' : 'bg-[var(--paper)] text-[var(--ink-faint)] border-[var(--line)]'}`}>
                      {c === 'sms' ? 'SMS' : 'WhatsApp'}
                    </button>
                  ))}
                </div>
              </div>

              {preview && form.batch_id && (
                <div className="rounded-xl bg-[var(--canvas)] border border-[var(--line)] p-4">
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-[13px] font-semibold text-[var(--ink)]">Reach</span>
                    <span className="text-[13px] text-[var(--accent)] font-semibold">{preview.studentCount} student{preview.studentCount === 1 ? '' : 's'}</span>
                  </div>
                  {!preview.hasLink && <p className="text-[12px] text-[var(--danger)] mb-2">This class has no Zoom link set.</p>}
                  <div className="text-[12px] font-semibold text-[var(--ink-soft)] mb-1">Message preview</div>
                  <div className="text-[13px] text-[var(--ink-soft)] whitespace-pre-wrap bg-[var(--paper)] rounded-lg p-3 border border-[var(--line-soft)] leading-relaxed">{preview.message}</div>
                </div>
              )}

              <Button onClick={create} disabled={saving} className="w-full">{saving ? 'Scheduling…' : 'Schedule reminder'}</Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

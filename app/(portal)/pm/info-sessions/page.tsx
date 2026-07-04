'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Field, inputClass, textareaClass, Spinner, EmptyState, Badge } from '@/components/ui'
import { toast } from 'sonner'

export default function InfoSessions() {
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', link: '', description: '', scheduled_at: '', notify_at: '', audience: 'all_leads', channels: ['sms', 'whatsapp'] })

  async function load() {
    const d = await fetch('/api/info-sessions').then(r => r.json())
    setSessions(d.sessions || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function set(k: string, v: any) { setForm(f => ({ ...f, [k]: v })) }

  async function create() {
    if (!form.title.trim() || !form.link.trim() || !form.scheduled_at || !form.notify_at) {
      toast.error('Fill in the title, link, session time and send time.'); return
    }
    setSaving(true)
    const res = await fetch('/api/info-sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, channels: form.channels.join(',') }),
    })
    const d = await res.json()
    setSaving(false)
    if (d.session) {
      toast.success('Info session scheduled. It will send automatically.')
      setForm({ title: '', link: '', description: '', scheduled_at: '', notify_at: '', audience: 'all_leads', channels: ['sms', 'whatsapp'] })
      load()
    } else toast.error(d.error || 'Could not schedule.')
  }

  async function cancel(id: string) {
    await fetch('/api/info-sessions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'cancel' }) })
    toast.success('Cancelled'); load()
  }

  function toggleChannel(c: string) {
    setForm(f => ({ ...f, channels: f.channels.includes(c) ? f.channels.filter(x => x !== c) : [...f.channels, c] }))
  }

  return (
    <div className="fade-in w-full">
      <PageHeader eyebrow="Automation" title="Info sessions"
        description="Schedule an info session once. At the send time, the system automatically texts and WhatsApps every lead, and pushes the link to all marketers to share. No manual sending." />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        {/* Scheduled sessions */}
        <div>
          {loading ? <Spinner /> : sessions.length === 0 ? (
            <EmptyState title="No info sessions yet" description="Schedule your first one on the right — it will broadcast automatically at the time you set." />
          ) : (
            <div className="space-y-3">
              {sessions.map(s => {
                const when = new Date(s.scheduled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                const sendWhen = new Date(s.notify_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                return (
                  <Card key={s.id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-display text-[16px] font-semibold text-[var(--ink)]">{s.title}</h3>
                          <Badge tone={s.status === 'sent' ? 'ok' : s.status === 'cancelled' ? 'danger' : 'info'}>{s.status}</Badge>
                        </div>
                        <p className="text-[13px] text-[var(--ink-soft)] mt-1">Session: {when}</p>
                        {s.status === 'scheduled' && <p className="text-[13px] text-[var(--ink-faint)]">Auto-sends: {sendWhen}</p>}
                        {s.status === 'sent' && <p className="text-[13px] text-[var(--ok)]">Sent to {s.leads_notified} leads · {s.marketers_notified} marketers notified</p>}
                        <a href={s.link} target="_blank" className="text-[13px] text-[var(--accent)] hover:underline break-all">{s.link}</a>
                      </div>
                      {s.status === 'scheduled' && (
                        <button onClick={() => cancel(s.id)} className="text-[13px] text-[var(--danger)] font-medium flex-shrink-0">Cancel</button>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* Schedule form */}
        <Card className="p-6">
          <h3 className="font-display text-[16px] font-semibold text-[var(--ink)] mb-4">Schedule a session</h3>
          <div className="space-y-4">
            <Field label="Title"><input className={inputClass} placeholder="PMP Info Session" value={form.title} onChange={e => set('title', e.target.value)} /></Field>
            <Field label="Meeting link"><input className={inputClass} placeholder="https://zoom.us/j/..." value={form.link} onChange={e => set('link', e.target.value)} /></Field>
            <Field label="Note (optional)"><textarea className={textareaClass} rows={2} placeholder="Bring your questions!" value={form.description} onChange={e => set('description', e.target.value)} /></Field>
            <Field label="When is the session?"><input type="datetime-local" className={inputClass} value={form.scheduled_at} onChange={e => set('scheduled_at', e.target.value)} /></Field>
            <Field label="When should it auto-send?"><input type="datetime-local" className={inputClass} value={form.notify_at} onChange={e => set('notify_at', e.target.value)} /></Field>
            <Field label="Who to notify">
              <select className={inputClass} value={form.audience} onChange={e => set('audience', e.target.value)}>
                <option value="all_leads">All active leads</option>
                <option value="uncontacted">Uncontacted leads only</option>
                <option value="interested">Interested / ready-to-join</option>
              </select>
            </Field>
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
            <Button onClick={create} disabled={saving} className="w-full">{saving ? 'Scheduling…' : 'Schedule session'}</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

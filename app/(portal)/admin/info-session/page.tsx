'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Field, inputClass, SectionLabel, Badge } from '@/components/ui'
import { Video, Copy, Send, Users } from 'lucide-react'
import { toast } from 'sonner'

export default function InfoSessionAdmin() {
  const [link, setLink] = useState('')
  const [title, setTitle] = useState('')
  const [datetime, setDatetime] = useState('')
  const [saving, setSaving] = useState(false)
  const [broadcasting, setBroadcasting] = useState(false)
  const [audience, setAudience] = useState<'all' | 'active'>('active')

  useEffect(() => {
    fetch('/api/info-session').then(r => r.json()).then(d => {
      setLink(d.link || ''); setTitle(d.title || ''); setDatetime(d.datetime || '')
    }).catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/info-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', link, title, datetime }),
      }).then(r => r.json())
      if (res.success) toast.success('Info session saved — marketers can now see and share it')
      else toast.error(res.error || 'Failed')
    } catch { toast.error('Failed to save') }
    finally { setSaving(false) }
  }

  async function broadcast() {
    if (!link) { toast.error('Save a link first'); return }
    if (!confirm(`Send the info-session invite to ${audience === 'all' ? 'ALL leads' : 'all active leads'}?`)) return
    setBroadcasting(true)
    try {
      const res = await fetch('/api/info-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'broadcast', link, title, datetime, audience }),
      }).then(r => r.json())
      if (res.success) toast.success(`Invite sent to ${res.sent} of ${res.total} leads`)
      else toast.error(res.error || 'Failed')
    } catch { toast.error('Broadcast failed') }
    finally { setBroadcasting(false) }
  }

  return (
    <div className="fade-in w-full max-w-3xl mx-auto">
      <PageHeader
        eyebrow="Outreach"
        title="Information session"
        description="Set the info-session link once. Every marketer sees it on their portal to share, and you can invite all leads in one click."
      />

      <Card className="p-6 mb-6">
        <SectionLabel>Session details</SectionLabel>
        <div className="space-y-4 mt-3">
          <Field label="Session link (Zoom, Meet, etc.)" required>
            <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://zoom.us/j/..." className={inputClass} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Title (optional)">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. June Info Session" className={inputClass} />
            </Field>
            <Field label="Date & time (optional)">
              <input value={datetime} onChange={e => setDatetime(e.target.value)} placeholder="e.g. Sat 21 June, 4pm" className={inputClass} />
            </Field>
          </div>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save session'}</Button>
        </div>
      </Card>

      {link && (
        <Card className="p-6">
          <SectionLabel>Invite leads</SectionLabel>
          <p className="text-sm text-[var(--ink-soft)] mt-2 mb-4">Send the invite by WhatsApp (falls back to SMS) to your leads. Marketers can also copy the link from their own portal to share manually.</p>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button onClick={() => setAudience('active')}
              className={`h-9 px-3 rounded-lg text-sm font-medium transition ${audience === 'active' ? 'bg-[var(--accent)] text-white' : 'bg-white border border-[var(--line)] text-[var(--ink-soft)]'}`}>
              Active leads only
            </button>
            <button onClick={() => setAudience('all')}
              className={`h-9 px-3 rounded-lg text-sm font-medium transition ${audience === 'all' ? 'bg-[var(--accent)] text-white' : 'bg-white border border-[var(--line)] text-[var(--ink-soft)]'}`}>
              All leads
            </button>
          </div>
          <Button onClick={broadcast} disabled={broadcasting} icon={<Send size={15} />}>
            {broadcasting ? 'Sending…' : `Send invite to ${audience === 'all' ? 'all' : 'active'} leads`}
          </Button>
        </Card>
      )}
    </div>
  )
}

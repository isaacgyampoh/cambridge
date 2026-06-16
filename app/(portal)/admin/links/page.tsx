'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Badge, Field, inputClass, SectionLabel, EmptyState, Spinner } from '@/components/ui'
import { Link2, Plus, Trash2, Video, Calendar, Megaphone, Send } from 'lucide-react'
import { toast } from 'sonner'

const TYPES: Record<string, { label: string; icon: any }> = {
  zoom: { label: 'Online class / Zoom', icon: Video },
  info_session: { label: 'Info session', icon: Calendar },
  announcement: { label: 'Announcement', icon: Megaphone },
  general: { label: 'General', icon: Link2 },
}

export default function AdminLinks() {
  const [links, setLinks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [form, setForm] = useState({ title: '', url: '', link_type: 'zoom', description: '', audience: 'all', expires_at: '' })

  async function load() {
    setLoading(true)
    const d = await fetch('/api/links').then(r => r.json()).catch(() => ({ links: [] }))
    setLinks(d.links || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function post() {
    if (!form.title.trim() || !form.url.trim()) { toast.error('Add a title and the link'); return }
    setPosting(true)
    try {
      const res = await fetch('/api/links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'post', ...form, expires_at: form.expires_at || null }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success(`Link posted — ${res.notified} people notified. It's now in everyone's My Links.`)
      setForm({ title: '', url: '', link_type: 'zoom', description: '', audience: 'all', expires_at: '' })
      load()
    } catch (e: any) { toast.error(e.message) }
    finally { setPosting(false) }
  }

  async function remove(id: string) {
    if (!confirm('Remove this link from everyone\'s My Links?')) return
    await fetch('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', id }) })
    toast.success('Link removed'); load()
  }

  return (
    <div className="fade-in w-full max-w-3xl mx-auto">
      <PageHeader
        eyebrow="Distribution"
        title="Post a link"
        description="Paste a link once — it instantly appears in every worker's My Links and notifies them. Temporary links (like a class Zoom) can auto-expire."
      />

      {/* Post form */}
      <Card className="p-6 mb-6">
        <SectionLabel>New link</SectionLabel>
        <div className="space-y-4 mt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Type">
              <select value={form.link_type} onChange={e => setForm(f => ({ ...f, link_type: e.target.value }))} className={inputClass}>
                {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Who sees it">
              <select value={form.audience} onChange={e => setForm(f => ({ ...f, audience: e.target.value }))} className={inputClass}>
                <option value="all">Everyone</option>
                <option value="marketers">Marketers only</option>
                <option value="staff">Staff (non-marketers)</option>
              </select>
            </Field>
          </div>
          <Field label="Title" required>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. PMP Class — Saturday Zoom" className={inputClass} />
          </Field>
          <Field label="Link / URL" required>
            <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://zoom.us/j/..." className={inputClass} />
          </Field>
          <Field label="Note (optional)">
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Join 10 mins early" className={inputClass} />
          </Field>
          <Field label="Auto-remove on (optional)">
            <input type="datetime-local" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} className={inputClass} />
          </Field>
          <Button onClick={post} disabled={posting} icon={<Send size={15} />}>{posting ? 'Posting…' : 'Post link to everyone'}</Button>
        </div>
      </Card>

      {/* Active links */}
      <SectionLabel>Active links</SectionLabel>
      {loading ? <Spinner /> : links.length === 0 ? (
        <EmptyState icon={<Link2 size={20} />} title="No active links" description="Post a link above and it appears here and in everyone's My Links." />
      ) : (
        <div className="space-y-2 mt-3">
          {links.map((l: any) => {
            const T = TYPES[l.link_type] || TYPES.general
            const Icon = T.icon
            return (
              <Card key={l.id} className="p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center flex-shrink-0"><Icon size={16} /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[var(--ink)] truncate">{l.title}</div>
                  <div className="text-xs text-[var(--ink-faint)] truncate">{l.url}</div>
                </div>
                <Badge tone="neutral">{l.audience === 'all' ? 'Everyone' : l.audience === 'marketers' ? 'Marketers' : 'Staff'}</Badge>
                {l.expires_at && <Badge tone="warning">Expires {new Date(l.expires_at).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}</Badge>}
                <button onClick={() => remove(l.id)} className="p-2 text-[var(--ink-faint)] hover:text-red-500"><Trash2 size={15} /></button>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

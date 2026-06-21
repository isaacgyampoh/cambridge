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
  const [sendToLeads, setSendToLeads] = useState(false)
  const [leadAudience, setLeadAudience] = useState<'active' | 'all'>('active')

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
      toast.success(
        res.studentsSent > 0
          ? `Posted to marketers — auto-sent to ${res.studentsSent} online students via their marketers' WhatsApp.`
          : `Link posted — ${res.notified} people notified. It's now in everyone's My Links.`
      )

      // Optionally blast the link to leads too
      if (sendToLeads) {
        const lr = await fetch('/api/links/broadcast', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: form.url, title: form.title, audience: leadAudience }),
        }).then(r => r.json()).catch(() => null)
        if (lr?.success) toast.success(`Invite sent to ${lr.sent} of ${lr.total} leads`)
      }

      setForm({ title: '', url: '', link_type: 'zoom', description: '', audience: 'all', expires_at: '' })
      setSendToLeads(false)
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
              {form.link_type === 'zoom' ? (
                <div className="h-11 px-4 rounded-xl border border-[var(--line)] bg-[var(--line-soft)] text-sm text-[var(--ink-soft)] flex items-center">Marketers (auto)</div>
              ) : (
                <select value={form.audience} onChange={e => setForm(f => ({ ...f, audience: e.target.value }))} className={inputClass}>
                  <option value="all">Everyone</option>
                  <option value="marketers">Marketers only</option>
                  <option value="staff">Staff (non-marketers)</option>
                </select>
              )}
            </Field>
          </div>

          {form.link_type === 'zoom' && (
            <div className="rounded-xl bg-[var(--accent-soft)] border border-[var(--accent)]/15 px-4 py-3">
              <p className="text-sm text-[var(--ink)]">This online-class link goes to all marketers, and is <strong>automatically sent by WhatsApp to every online-registered student</strong> through their own marketer's line — no manual sharing needed.</p>
            </div>
          )}
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

          {/* Also invite leads */}
          <div className="rounded-xl border border-[var(--line)] p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <button type="button" role="switch" aria-checked={sendToLeads} onClick={() => setSendToLeads(s => !s)}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${sendToLeads ? 'bg-[var(--accent)]' : 'bg-[var(--line)]'}`}>
                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${sendToLeads ? 'translate-x-5' : ''}`} />
              </button>
              <div>
                <div className="text-sm font-medium text-[var(--ink)]">Also send this link to leads</div>
                <div className="text-xs text-[var(--ink-faint)]">Blast it by WhatsApp/SMS — useful for info-session invites</div>
              </div>
            </label>
            {sendToLeads && (
              <div className="flex gap-2 mt-3 pl-14">
                <button type="button" onClick={() => setLeadAudience('active')}
                  className={`h-8 px-3 rounded-lg text-xs font-medium transition ${leadAudience === 'active' ? 'bg-[var(--accent)] text-white' : 'bg-white border border-[var(--line)] text-[var(--ink-soft)]'}`}>Active leads</button>
                <button type="button" onClick={() => setLeadAudience('all')}
                  className={`h-8 px-3 rounded-lg text-xs font-medium transition ${leadAudience === 'all' ? 'bg-[var(--accent)] text-white' : 'bg-white border border-[var(--line)] text-[var(--ink-soft)]'}`}>All leads</button>
              </div>
            )}
          </div>

          <Button onClick={post} disabled={posting} icon={<Send size={15} />}>{posting ? 'Posting…' : 'Post link'}</Button>
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
                <button onClick={() => remove(l.id)} className="p-2 text-[var(--ink-faint)] hover:text-[var(--danger)]"><Trash2 size={15} /></button>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

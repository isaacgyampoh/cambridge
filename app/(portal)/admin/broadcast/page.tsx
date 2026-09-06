'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { readableStatus } from '@/lib/ui/status'
import { useData } from '@/hooks/useData'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import {
  PageHeader, Card, Button, Badge, Field, inputClass, SectionLabel,
  Tabs, MobileList, ListRow,
} from '@/components/ui'
import { Send, Plus, X, Video, Calendar, Megaphone, Link2, Trash2 } from 'lucide-react'
import { useConfirm } from '@/hooks/useConfirm'

type Broadcast = {
  id: string
  title: string
  message: string
  status: string
  channels: string[] | null
  target_count: number
  sent_count: number
  failed_count: number
  created_at: string
}

type PostedLink = {
  id: string
  title: string
  url: string
  audience: string
  expires_at: string | null
}

type Batch = { id: string; name: string }

/** The sub-filters a target type can carry. Was `any`, so a typo was silent. */
type TargetFilters = { status?: string; source?: string; batch_id?: string }

const LINK_TYPES: Record<string, { label: string; icon: React.ComponentType<{ size?: number }> }> = {
  zoom: { label: 'Online class / Zoom', icon: Video },
  info_session: { label: 'Info session', icon: Calendar },
  announcement: { label: 'Announcement', icon: Megaphone },
  general: { label: 'General', icon: Link2 },
}

const TARGET_TYPES = [
  { value: 'all_leads', label: 'All Leads', desc: 'Every lead in the system'},
  { value: 'leads_by_status', label: 'Leads by Status', desc: 'Filter by pipeline stage'},
  { value: 'leads_by_source', label: 'Leads by Source', desc: 'Facebook, Google, etc.'},
  { value: 'all_students', label: 'All Students', desc: 'Everyone enrolled'},
  { value: 'batch_students', label: 'Specific Batch', desc: 'Students in one class'},
  { value: 'interested_not_converted', label: 'Interested but not joined', desc: 'Hot leads to re-engage'},
  { value: 'uncontacted_leads', label: 'Uncontacted Leads', desc: 'New leads not yet reached'},
]

const STATUS_OPTS = ['new', 'contacted', 'interested', 'follow_up', 'not_interested', 'lost']
const SOURCE_OPTS = ['facebook', 'google', 'linkedin', 'website', 'referral', 'manual']

export default function BroadcastPage() {
  const { confirm, dialog } = useConfirm()
  const [tab, setTab] = useState<'message' | 'link'>('message')

  const { data: broadcasts, loading, refetch: load } = useData<Broadcast>({
    table: 'broadcasts', orderBy: 'created_at', orderAsc: false, limit: 20,
  })
  const { data: batches } = useData<Batch>({
    table: 'batches', select: 'id, name, courses(name)',
    filters: [{ col: 'status', op: 'eq', val: 'ongoing'}], limit: 100,
  })
  const [modal, setModal] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)

  // ── Post-a-link state ──
  const [links, setLinks] = useState<PostedLink[]>([])
  const [linksLoading, setLinksLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [linkForm, setLinkForm] = useState({ title: '', url: '', link_type: 'zoom', description: '', audience: 'all', expires_at: '' })
  const [sendToLeads, setSendToLeads] = useState(false)
  const [leadAudience, setLeadAudience] = useState<'active' | 'all'>('active')

  /*
   * Fetch only — no state is touched here.
   *
   * setLinksLoading(true) ran synchronously inside the effect below, which
   * React 19 flags as a cascading render because it is a second render before
   * the first has painted. The component already starts in its loading state,
   * so the first paint is correct and only the result needs applying.
   */
  const fetchLinks = useCallback(async (): Promise<PostedLink[] | null> => {
    try {
      const d = await fetch('/api/links').then(r => r.json())
      return (d.links || []) as PostedLink[]
    } catch {
      return null
    }
  }, [])

  const applyLinks = useCallback((rows: PostedLink[] | null) => {
    // A failed request is not an empty list: "no active links" would read as
    // "nothing was ever posted".
    if (!rows) toast.error('Could not load the posted links.')
    setLinks(rows || [])
    setLinksLoading(false)
  }, [])

  const loadLinks = useCallback(async () => {
    applyLinks(await fetchLinks())
  }, [applyLinks, fetchLinks])

  useEffect(() => {
    let alive = true
    fetchLinks().then(rows => { if (alive) applyLinks(rows) })
    return () => { alive = false }
  }, [fetchLinks, applyLinks])

  async function postLink() {
    if (!linkForm.title.trim() || !linkForm.url.trim()) { toast.error('Add a title and the link'); return }
    setPosting(true)
    try {
      const res = await fetch('/api/links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'post', ...linkForm, expires_at: linkForm.expires_at || null }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success(
        res.studentsSent > 0
          ? `Posted to marketers — auto-sent to ${res.studentsSent} online students via their marketers' WhatsApp.`
          : `Link posted — ${res.notified} people notified. It's now in everyone's My Links.`
      )
      if (sendToLeads) {
        const lr = await fetch('/api/links/broadcast', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: linkForm.url, title: linkForm.title, audience: leadAudience }),
        }).then(r => r.json()).catch(() => null)
        if (lr?.success) toast.success(`Invite sent to ${lr.sent} of ${lr.total} leads`)
      }
      setLinkForm({ title: '', url: '', link_type: 'zoom', description: '', audience: 'all', expires_at: '' })
      setSendToLeads(false)
      loadLinks()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'That did not work.') }
    finally { setPosting(false) }
  }

  async function removeLink(id: string) {
    if (!await confirm({
      title: 'Remove this link?',
      message: 'It disappears from every staff member\u2019s My Links. The destination itself is not affected.',
      confirmLabel: 'Remove link',
    })) return
    await fetch('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', id }) })
    toast.success('Link removed'); loadLinks()
  }

  async function sendNow(broadcastId: string) {
    setSendingId(broadcastId)
    try {
      const res = await fetch('/api/broadcast/send-now', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcastId }),
      })
      const d = await res.json()
      if (d.success) {
        if (d.sent > 0) toast.success(`Sent to ${d.sent} recipient${d.sent === 1 ? '' : 's'}${d.failed ? `, ${d.failed} failed` : ''}`)
        else toast.error(d.note || 'Nothing delivered. Check Settings, then Test delivery.')
      }
      else toast.error(d.error || 'Could not send')
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'That did not work.') }
    finally { setSendingId(null) }
  }
  const [preview, setPreview] = useState<{ count: number; names: string[] } | null>(null)
  const [form, setForm] = useState({
    title: '', message: '', channels: ['whatsapp'] as string[],
    target_type: 'all_leads', target_filters: {} as TargetFilters,
    scheduled_at: '',
  })

  async function getPreview() {
    const res = await fetch('/api/broadcast/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json'},
      body: JSON.stringify({ target_type: form.target_type, target_filters: form.target_filters }),
    })
    const d = await res.json()
    setPreview(d)
  }

  async function sendBroadcast() {
    if (!form.title || !form.message) { toast.error('Fill in title and message'); return }
    setSending(true)
    const res = await fetch('/api/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json'},
      body: JSON.stringify(form),
    })
    const d = await res.json()
    if (d.success) {
      toast.success(`Broadcast ${form.scheduled_at ? 'scheduled': 'queued'}! Sending to ${d.count} recipients.`)
      setModal(false)
      setForm({ title: '', message: '', channels: ['whatsapp'], target_type: 'all_leads', target_filters: {}, scheduled_at: ''})
      setPreview(null)
      load()
    } else {
      toast.error(d.error || 'Failed to send broadcast')
    }
    setSending(false)
  }

  function toggleChannel(ch: string) {
    setForm(f => ({
      ...f,
      channels: f.channels.includes(ch)
        ? f.channels.filter(c => c !== ch)
        : [...f.channels, ch]
    }))
  }

  // Message templates
  const TEMPLATES = [
    { label: 'Class announcement', text: 'Hello {{name}}! We have exciting news from Cambridge Center of Excellence. Our next {{course}} class is starting soon. Don\'t miss out! Contact us to reserve your spot.'},
    { label: 'Re-engagement', text: 'Hello {{name}}! It\'s been a while. We miss you at Cambridge! We have a special offer just for you. Reply to this message and let\'s get you started on your certification journey. '},
    { label: 'Special offer', text: 'Hello {{name}}! Cambridge Center of Excellence is offering a limited-time discount on our {{course}} program. Don\'t miss this opportunity to advance your career! Contact us today.'},
    { label: 'New course alert', text: 'Hello {{name}}! Cambridge Center of Excellence is launching a new course! Be among the first to enroll and take your career to the next level. Reply for details. '},
  ]

  /* Meaning, not colour — Badge decides how a tone looks. */
  const STATUS_TONE: Record<string, 'neutral' | 'accent' | 'success' | 'danger'> = {
    draft: 'neutral', sending: 'accent', sent: 'success', failed: 'danger',
  }

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      {dialog}
      <PageHeader
        eyebrow="Outreach"
        title="Broadcast & links"
        description="Send a bulk message, or post a link that lands in every worker's My Links."
        actions={
          tab === 'message'
            ? <Button onClick={() => setModal(true)}><Plus size={16} aria-hidden="true" /> New broadcast</Button>
            : undefined
        }
      />

      <Tabs
        tabs={[
          { key: 'message', label: 'Send a message', count: broadcasts.length },
          { key: 'link', label: 'Post a link', count: links.length },
        ]}
        active={tab}
        onChange={k => setTab(k as 'message' | 'link')}
        label="Outreach type"
        className="mb-5"
      />

      {tab === 'message' && (
      <div>
      {/* Broadcast modal */}
      {(
        <Modal open={modal} onClose={() => setModal(false)} maxWidth="max-w-2xl">
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-[var(--ink)]">New Broadcast</h2>
              <button type="button" onClick={() => setModal(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink-soft)]" aria-label="Close"><X size={18} aria-hidden="true" /></button>
            </div>

            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-[13px] font-medium text-[var(--ink-faint)] mb-1.5">Campaign Title</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. PMP June Intake Announcement"
                  className="w-full h-11 px-4 rounded-2xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
              </div>

              {/* Target */}
              <div>
                <label className="block text-[13px] font-medium text-[var(--ink-faint)] mb-1.5">Target Audience</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {TARGET_TYPES.map(t => (
                    <button key={t.value} onClick={() => setForm(f => ({ ...f, target_type: t.value, target_filters: {} }))}
                      className={`text-left p-3 rounded-2xl border-2 transition ${form.target_type === t.value ? 'border-[var(--accent)] bg-[var(--accent-soft)]': 'border-[var(--line)] hover:border-[var(--line)]'}`}>
                      <div className="text-sm font-semibold text-[var(--ink)]">{t.label}</div>
                      <div className="text-xs text-[var(--ink-faint)]">{t.desc}</div>
                    </button>
                  ))}
                </div>

                {/* Sub-filters */}
                {form.target_type === 'leads_by_status'&& (
                  <select value={form.target_filters.status || ''} onChange={e => setForm(f => ({ ...f, target_filters: { status: e.target.value } }))}
                    className="w-full h-10 px-3 rounded-2xl border border-[var(--line)] text-sm bg-white focus:outline-none">
                    <option value="">Select status...</option>
                    {STATUS_OPTS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                )}
                {form.target_type === 'leads_by_source'&& (
                  <select value={form.target_filters.source || ''} onChange={e => setForm(f => ({ ...f, target_filters: { source: e.target.value } }))}
                    className="w-full h-10 px-3 rounded-2xl border border-[var(--line)] text-sm bg-white focus:outline-none">
                    <option value="">Select source...</option>
                    {SOURCE_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                {form.target_type === 'batch_students'&& (
                  <select value={form.target_filters.batch_id || ''} onChange={e => setForm(f => ({ ...f, target_filters: { batch_id: e.target.value } }))}
                    className="w-full h-10 px-3 rounded-2xl border border-[var(--line)] text-sm bg-white focus:outline-none">
                    <option value="">Select batch...</option>
                    {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                )}

                {/* Preview */}
                <button onClick={getPreview} className="mt-2 text-xs text-[var(--accent)] hover:text-[var(--accent)] font-semibold">
                  Preview audience
                </button>
                {preview && (
                  <div className="mt-2 p-3 bg-[var(--accent-soft)] rounded-xl text-sm">
                    <span className="font-bold text-[var(--accent)]">{preview.count} recipients</span>
                    {preview.names?.length > 0 && (
                      <span className="text-[var(--accent)] ml-2">({preview.names.slice(0, 3).join(', ')}{preview.count > 3 ? ` +${preview.count - 3} more` : ''})</span>
                    )}
                  </div>
                )}
              </div>

              {/* Channels */}
              <div>
                <label className="block text-[13px] font-medium text-[var(--ink-faint)] mb-2">Send via</label>
                <div className="flex gap-2">
                  {[
                    { key: 'whatsapp', label: 'WhatsApp', color: 'border-green-400 bg-[var(--ok-soft)] text-[var(--ok)]'},
                    { key: 'sms', label: 'SMS', color: 'border-blue-400 bg-[var(--accent-soft)] text-[var(--accent)]'},
                  ].map(ch => (
                    <button key={ch.key} onClick={() => toggleChannel(ch.key)}
                      className={`px-4 py-2 rounded-2xl border-2 text-sm font-semibold transition ${form.channels.includes(ch.key) ? ch.color : 'border-[var(--line)] text-[var(--ink-faint)]'}`}>
                      {ch.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[13px] font-medium text-[var(--ink-faint)]">Message</label>
                  <span className="text-xs text-[var(--ink-faint)]">{form.message.length} chars · Use {'{{name}}'} for personalization</span>
                </div>
                <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  rows={5} placeholder="Hello {{name}}! ..."
                  className="w-full px-4 py-3 rounded-2xl border border-[var(--line)] text-sm resize-none focus:outline-none focus:border-[var(--accent)] mb-2" />
                {/* Templates */}
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATES.map(t => (
                    <button key={t.label} onClick={() => setForm(f => ({ ...f, message: t.text }))}
                      className="text-[12px] px-2 py-1 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-lg hover:bg-[var(--line)] transition">
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Schedule */}
              <div>
                <label className="block text-[13px] font-medium text-[var(--ink-faint)] mb-1.5">
                  Schedule (leave blank to send now)
                </label>
                <input type="datetime-local" value={form.scheduled_at}
                  onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))}
                  className="h-11 px-4 rounded-2xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={sendBroadcast} disabled={sending}
                className="flex-1 h-12 bg-[var(--accent)] text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:brightness-110 transition flex items-center justify-center gap-2">
                {sending ? null : form.scheduled_at
                  ? <Calendar size={16} aria-hidden="true" />
                  : <Send size={16} aria-hidden="true" />}
                {sending ? 'Sending…' : form.scheduled_at ? 'Schedule broadcast' : 'Send now'}
              </button>
              <button onClick={() => setModal(false)} className="flex-1 h-12 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/*
        Broadcast history.

        MobileList owns loading, empty and error, so a failed request can no
        longer render as "no broadcasts yet" — which on this screen would read
        as "nothing was ever sent".
      */}
      <MobileList
        rows={broadcasts}
        rowKey={b => b.id}
        state={loading ? 'loading' : 'ready'}
        emptyTitle="No broadcasts yet"
        emptyMessage="Send a bulk message and it will be listed here with what happened to it."
        renderRow={b => (
          <ListRow
            title={b.title}
            subtitle={b.message}
            status={<Badge tone={STATUS_TONE[b.status] || 'neutral'}>{readableStatus(b.status)}</Badge>}
            meta={
              <>
                <span className="tabular-nums">{b.target_count} targeted</span>
                <span className="tabular-nums text-[var(--ok)]">{b.sent_count} sent</span>
                {b.failed_count > 0 && (
                  <span className="tabular-nums text-[var(--danger)]">{b.failed_count} failed</span>
                )}
                {(b.channels || []).map((ch: string) => (
                  <Badge key={ch} tone={ch === 'whatsapp' ? 'success' : 'accent'}>{ch}</Badge>
                ))}
                <span>{formatDateTime(b.created_at)}</span>
              </>
            }
            actions={
              (b.status === 'draft' || (b.failed_count > 0 && b.sent_count === 0)) ? (
                <Button size="sm" disabled={sendingId === b.id} onClick={() => sendNow(b.id)}>
                  {sendingId === b.id ? 'Sending…' : 'Send now'}
                </Button>
              ) : undefined
            }
          />
        )}
      />
      </div>
      )}

      {tab === 'link' && (
      <div>
        {/* Post form */}
        <Card className="p-6 mb-6">
          <SectionLabel>New link</SectionLabel>
          <div className="space-y-4 mt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Type">
                <select value={linkForm.link_type} onChange={e => setLinkForm(f => ({ ...f, link_type: e.target.value }))} className={inputClass}>
                  {Object.entries(LINK_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Who sees it">
                {linkForm.link_type === 'zoom' ? (
                  <div className="h-11 px-4 rounded-2xl border border-[var(--line)] bg-[var(--line-soft)] text-sm text-[var(--ink-soft)] flex items-center">Marketers (auto)</div>
                ) : (
                  <select value={linkForm.audience} onChange={e => setLinkForm(f => ({ ...f, audience: e.target.value }))} className={inputClass}>
                    <option value="all">Everyone</option>
                    <option value="marketers">Marketers only</option>
                    <option value="staff">Staff (non-marketers)</option>
                  </select>
                )}
              </Field>
            </div>

            {linkForm.link_type === 'zoom' && (
              <div className="rounded-xl bg-[var(--accent-soft)] border border-[var(--accent)]/15 px-4 py-3">
                <p className="text-sm text-[var(--ink)]">This online-class link goes to all marketers, and is <strong>automatically sent by WhatsApp to every online-registered student</strong> through their own marketer’s line — no manual sharing needed.</p>
              </div>
            )}
            <Field label="Title" required>
              <input value={linkForm.title} onChange={e => setLinkForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. PMP Class — Saturday Zoom" className={inputClass} />
            </Field>
            <Field label="Link / URL" required>
              <input value={linkForm.url} onChange={e => setLinkForm(f => ({ ...f, url: e.target.value }))} placeholder="https://zoom.us/j/..." className={inputClass} />
            </Field>
            <Field label="Note (optional)">
              <input value={linkForm.description} onChange={e => setLinkForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Join 10 mins early" className={inputClass} />
            </Field>
            <Field label="Auto-remove on (optional)">
              <input type="datetime-local" value={linkForm.expires_at} onChange={e => setLinkForm(f => ({ ...f, expires_at: e.target.value }))} className={inputClass} />
            </Field>

            <div className="rounded-2xl border border-[var(--line)] p-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <button type="button" role="switch" aria-checked={sendToLeads} onClick={() => setSendToLeads(s => !s)}
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${sendToLeads ? 'bg-[var(--accent)]' : 'bg-[var(--line)]'}`}>
                  <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-[var(--shadow-raised)] transition-transform ${sendToLeads ? 'translate-x-5' : ''}`} />
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

            <Button onClick={postLink} disabled={posting}>{posting ? 'Posting…' : 'Post link'}</Button>
          </div>
        </Card>

        <SectionLabel>Active links</SectionLabel>
        <div className="mt-3">
          <MobileList
            rows={links}
            rowKey={l => l.id}
            state={linksLoading ? 'loading' : 'ready'}
            emptyTitle="No active links"
            emptyMessage="Post a link above and it appears here, and in everyone's My Links."
            renderRow={l => (
              <ListRow
                title={l.title}
                subtitle={l.url}
                meta={
                  <>
                    <Badge tone="neutral">
                      {l.audience === 'all' ? 'Everyone' : l.audience === 'marketers' ? 'Marketers' : 'Staff'}
                    </Badge>
                    {l.expires_at && (
                      <Badge tone="warning">
                        Expires {new Date(l.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </Badge>
                    )}
                  </>
                }
                actions={
                  <button type="button" onClick={() => removeLink(l.id)}
                    aria-label={`Remove the link ${l.title}`}
                    className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg
                      text-[13px] font-medium text-[var(--danger)]
                      hover:bg-[var(--danger-soft)] transition-colors">
                    <Trash2 size={15} aria-hidden="true" /> Remove
                  </button>
                }
              />
            )}
          />
        </div>
      </div>
      )}
    </div>
  )
}

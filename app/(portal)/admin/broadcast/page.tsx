'use client'
import { useState } from 'react'
import { useData } from '@/hooks/useData'
import { toast } from 'sonner'
import { Send, Users, Clock, CheckCircle, XCircle, Plus, X } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import Modal from '@/components/shared/Modal'

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
  const { data: broadcasts, loading, refetch: load } = useData<any>({
    table: 'broadcasts', orderBy: 'created_at', orderAsc: false, limit: 20,
  })
  const { data: batches } = useData<any>({
    table: 'batches', select: 'id, name, courses(name)',
    filters: [{ col: 'status', op: 'eq', val: 'ongoing'}], limit: 100,
  })
  const [modal, setModal] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)

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
        else toast.error(d.note || 'Nothing delivered. Check Settings → Test delivery.')
      }
      else toast.error(d.error || 'Could not send')
      load()
    } catch (e: any) { toast.error(e.message) }
    finally { setSendingId(null) }
  }
  const [preview, setPreview] = useState<{ count: number; names: string[] } | null>(null)
  const [form, setForm] = useState({
    title: '', message: '', channels: ['whatsapp'] as string[],
    target_type: 'all_leads', target_filters: {} as any,
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
    { label: 'Class announcement', text: 'Hello {{name}}! We have exciting news from Cambridge Centre of Excellence. Our next {{course}} class is starting soon. Don\'t miss out! Contact us to reserve your spot.'},
    { label: 'Re-engagement', text: 'Hello {{name}}! It\'s been a while. We miss you at Cambridge! We have a special offer just for you. Reply to this message and let\'s get you started on your certification journey. '},
    { label: 'Special offer', text: 'Hello {{name}}! Cambridge Centre of Excellence is offering a limited-time discount on our {{course}} program. Don\'t miss this opportunity to advance your career! Contact us today.'},
    { label: 'New course alert', text: 'Hello {{name}}! Cambridge Centre of Excellence is launching a new course! Be among the first to enroll and take your career to the next level. Reply for details. '},
  ]

  const STATUS_CONFIG: Record<string, string> = {
    draft: 'bg-[var(--line-soft)] text-[var(--ink-soft)]',
    sending: 'bg-[var(--accent-soft)] text-[var(--accent)]',
    sent: 'bg-[var(--ok-soft)] text-[var(--ok)]',
    failed: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  }

  return (
    <div className="fade-in w-full">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-[13px] font-medium text-[var(--ink-faint)] mb-2">Messaging</div>
          <h1 className="font-display text-[28px] leading-tight font-semibold text-[var(--ink)]">Broadcasts</h1>
          <p className="text-[var(--ink-soft)] text-sm mt-1.5">Send bulk WhatsApp and SMS to any segment of leads or students.</p>
        </div>
        <button onClick={() => setModal(true)}
          className="inline-flex items-center gap-2 h-10 px-4 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:brightness-110 transition shadow-sm flex-shrink-0">
          <Plus size={15} /> New broadcast
        </button>
      </div>

      {/* Broadcast modal */}
      {(
        <Modal open={modal} onClose={() => setModal(false)} maxWidth="max-w-2xl">
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-[var(--ink)]">New Broadcast</h2>
              <button onClick={() => setModal(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink-soft)]"><X size={20} /></button>
            </div>

            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-[var(--ink-faint)] uppercase tracking-wide mb-1.5">Campaign Title</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. PMP June Intake Announcement"
                  className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
              </div>

              {/* Target */}
              <div>
                <label className="block text-xs font-semibold text-[var(--ink-faint)] uppercase tracking-wide mb-1.5">Target Audience</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {TARGET_TYPES.map(t => (
                    <button key={t.value} onClick={() => setForm(f => ({ ...f, target_type: t.value, target_filters: {} }))}
                      className={`text-left p-3 rounded-xl border-2 transition ${form.target_type === t.value ? 'border-blue-600 bg-[var(--accent-soft)]': 'border-[var(--line)] hover:border-gray-300'}`}>
                      <div className="text-sm font-semibold text-[var(--ink)]">{t.label}</div>
                      <div className="text-xs text-[var(--ink-faint)]">{t.desc}</div>
                    </button>
                  ))}
                </div>

                {/* Sub-filters */}
                {form.target_type === 'leads_by_status'&& (
                  <select value={form.target_filters.status || ''} onChange={e => setForm(f => ({ ...f, target_filters: { status: e.target.value } }))}
                    className="w-full h-10 px-3 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none">
                    <option value="">Select status...</option>
                    {STATUS_OPTS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                )}
                {form.target_type === 'leads_by_source'&& (
                  <select value={form.target_filters.source || ''} onChange={e => setForm(f => ({ ...f, target_filters: { source: e.target.value } }))}
                    className="w-full h-10 px-3 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none">
                    <option value="">Select source...</option>
                    {SOURCE_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                {form.target_type === 'batch_students'&& (
                  <select value={form.target_filters.batch_id || ''} onChange={e => setForm(f => ({ ...f, target_filters: { batch_id: e.target.value } }))}
                    className="w-full h-10 px-3 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none">
                    <option value="">Select batch...</option>
                    {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                )}

                {/* Preview */}
                <button onClick={getPreview} className="mt-2 text-xs text-[var(--accent)] hover:text-blue-800 font-semibold">
                  Preview audience
                </button>
                {preview && (
                  <div className="mt-2 p-3 bg-[var(--accent-soft)] rounded-xl text-sm">
                    <span className="font-bold text-[var(--accent)]">{preview.count} recipients</span>
                    {preview.names?.length > 0 && (
                      <span className="text-blue-500 ml-2">({preview.names.slice(0, 3).join(', ')}{preview.count > 3 ? ` +${preview.count - 3} more` : ''})</span>
                    )}
                  </div>
                )}
              </div>

              {/* Channels */}
              <div>
                <label className="block text-xs font-semibold text-[var(--ink-faint)] uppercase tracking-wide mb-2">Send via</label>
                <div className="flex gap-2">
                  {[
                    { key: 'whatsapp', label: 'WhatsApp', color: 'border-green-400 bg-[var(--ok-soft)] text-[var(--ok)]'},
                    { key: 'sms', label: 'SMS', color: 'border-blue-400 bg-[var(--accent-soft)] text-[var(--accent)]'},
                  ].map(ch => (
                    <button key={ch.key} onClick={() => toggleChannel(ch.key)}
                      className={`px-4 py-2 rounded-xl border-2 text-sm font-semibold transition ${form.channels.includes(ch.key) ? ch.color : 'border-[var(--line)] text-[var(--ink-faint)]'}`}>
                      {ch.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[var(--ink-faint)] uppercase tracking-wide">Message</label>
                  <span className="text-xs text-[var(--ink-faint)]">{form.message.length} chars · Use {'{{name}}'} for personalization</span>
                </div>
                <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  rows={5} placeholder="Hello {{name}}! ..."
                  className="w-full px-4 py-3 rounded-xl border border-[var(--line)] text-sm resize-none focus:outline-none focus:border-[var(--accent)] mb-2" />
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
                <label className="block text-xs font-semibold text-[var(--ink-faint)] uppercase tracking-wide mb-1.5">
                  Schedule (leave blank to send now)
                </label>
                <input type="datetime-local" value={form.scheduled_at}
                  onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))}
                  className="h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={sendBroadcast} disabled={sending}
                className="flex-1 h-12 bg-[var(--accent)] text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:brightness-110 transition flex items-center justify-center gap-2">
                <Send size={16} />
                {sending ? 'Sending...': form.scheduled_at ? 'Schedule Broadcast': 'Send Now'}
              </button>
              <button onClick={() => setModal(false)} className="flex-1 h-12 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Broadcasts list */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
      ) : (
        <div className="space-y-3">
          {broadcasts.map(b => (
            <div key={b.id} className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-medium text-[var(--ink)]">{b.title}</h3>
                  <p className="text-sm text-[var(--ink-soft)] mt-0.5 line-clamp-2">{b.message}</p>
                </div>
                <span className={`text-xs font-bold px-3 py-1 rounded-full ml-3 flex-shrink-0 ${STATUS_CONFIG[b.status]}`}>
                  {b.status}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-[var(--ink-faint)]">
                <span className="flex items-center gap-1"><Users size={12} /> {b.target_count} targeted</span>
                <span className="flex items-center gap-1 text-[var(--ok)]"><CheckCircle size={12} /> {b.sent_count} sent</span>
                {b.failed_count > 0 && <span className="flex items-center gap-1 text-[var(--danger)]"><XCircle size={12} /> {b.failed_count} failed</span>}
                <span className="flex items-center gap-1"><Clock size={12} /> {formatDateTime(b.created_at)}</span>
                <div className="flex gap-1 ml-auto items-center">
                  {(b.channels || []).map((ch: string) => (
                    <span key={ch} className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ch === 'whatsapp'? 'bg-[var(--ok-soft)] text-[var(--ok)]': 'bg-[var(--accent-soft)] text-[var(--accent)]'}`}>
                      {ch}
                    </span>
                  ))}
                  {(b.status === 'draft' || (b.failed_count > 0 && b.sent_count === 0)) && (
                    <button onClick={() => sendNow(b.id)} disabled={sendingId === b.id}
                      className="ml-2 px-3 py-1 rounded-md bg-[var(--accent)] text-white text-[12px] font-semibold hover:brightness-110 disabled:opacity-50 transition">
                      {sendingId === b.id ? 'Sending…' : 'Send now'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {broadcasts.length === 0 && (
            <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-16 text-center text-[var(--ink-faint)]">
              <Send size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">No broadcasts yet</p>
              <p className="text-sm mt-1">Create your first bulk message campaign</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

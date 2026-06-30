'use client'
import { useState, useEffect, use } from 'react'
import { mutate } from '@/hooks/useData'
import { formatDateTime, formatPhone, STATUS_COLORS, SOURCE_COLORS } from '@/lib/utils'
import { toast } from 'sonner'
import { ArrowLeft, Phone, MessageSquare, Mail, Calendar, Plus, Clock } from 'lucide-react'
import Link from 'next/link'
import Modal from '@/components/shared/Modal'
import { changeLeadStatus } from '@/lib/leadStatus'

const STATUSES = [
  { key: 'new', label: 'New'},
  { key: 'contacted', label: 'Contacted'},
  { key: 'interested', label: 'Interested'},
  { key: 'follow_up', label: 'Follow Up'},
  { key: 'ready_to_join', label: 'Ready to Join '},
  { key: 'not_interested', label: 'Not Interested'},
  { key: 'lost', label: 'Lost'},
]

const ACTIVITY_TYPES = [
  { key: 'call', label: 'Call', color: 'bg-[var(--ok-soft)] text-[var(--ok)]'},
  { key: 'whatsapp', label: 'WhatsApp', color: 'bg-emerald-100 text-[var(--ok)]'},
  { key: 'email', label: 'Email', color: 'bg-[var(--accent-soft)] text-[var(--accent)]'},
  { key: 'meeting', label: 'Meeting', color: 'bg-[var(--gold-soft)] text-[var(--gold)]'},
  { key: 'note', label: 'Note', color: 'bg-[var(--line-soft)] text-[var(--ink-soft)]'},
]


async function apiQuery(table: string, select: string, filters?: { col: string; op: string; val: any }[], limit = 100) {
  const params = new URLSearchParams({ table, select, limit: String(limit) })
  if (filters?.length) params.set('filters', JSON.stringify(filters))
  const res = await fetch(`/api/data?${params}`)
  const json = await res.json()
  return json.data || []
}

export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [lead, setLead] = useState<any>(null)
  const [activities, setActivities] = useState<any[]>([])
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [actType, setActType] = useState('call')
  const [actNote, setActNote] = useState('')
  const [actOutcome, setActOutcome] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [savingAct, setSavingAct] = useState(false)
  const [newStatus, setNewStatus] = useState('')
  const [regOpen, setRegOpen] = useState(false)
  const [programs, setPrograms] = useState<any[]>([])
  const [regForm, setRegForm] = useState({ programCode: '', delivery: 'in_person', corporateValue: '' })
  const [registering, setRegistering] = useState(false)

  useEffect(() => {
    async function init() {
      const s = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null)
      if (s?.valid) setProfile({ id: s.userId, full_name: s.fullName })
      // Load programmes for the register modal
      const params = new URLSearchParams({ table: 'program_points', select: '*', filters: JSON.stringify([{ col: 'is_active', op: 'eq', val: true }]), orderBy: 'sort_order', limit: '50' })
      fetch(`/api/data?${params}`).then(r => r.ok ? r.json() : { data: [] }).then(d => setPrograms(d.data || [])).catch(() => {})
      load()
    }
    init()
  }, [id])

  async function registerStudent() {
    if (!regForm.programCode) { toast.error('Select a programme'); return }
    setRegistering(true)
    try {
      const result = await changeLeadStatus(id, 'registered', {
        programCode: regForm.programCode, delivery: regForm.delivery,
        corporateValue: regForm.corporateValue ? parseFloat(regForm.corporateValue) : undefined,
      })
      if (result.error) { toast.error(result.error); return }
      toast.success('Registered — points credited to your annual total')
      setRegOpen(false)
      load()
    } catch (e: any) { toast.error(e.message) }
    finally { setRegistering(false) }
  }

  async function load() {
    const [leads, acts] = await Promise.all([
      apiQuery('leads', '*', [{ col: 'id', op: 'eq', val: id }], 1),
      apiQuery('lead_activities', '*, creator:created_by(full_name)', [{ col: 'lead_id', op: 'eq', val: id }], 30),
    ])
    const l = leads[0] || null
    setLead(l); setActivities(acts)
    setNewStatus(l?.status || '')
    setLoading(false)
  }

  async function logActivity() {
    if (!actNote.trim()) { toast.error('Add a note about this activity'); return }
    setSavingAct(true)
    try {
      await mutate('POST', 'lead_activities', {
        lead_id: id,
        activity_type: actType,
        subject: actType.charAt(0).toUpperCase() + actType.slice(1),
        description: actNote,
        outcome: actOutcome || null,
        next_follow_up: followUpDate ? new Date(followUpDate).toISOString() : null,
        created_by: profile?.id,
      })

      // Set follow-up queue if date provided
      if (followUpDate && profile?.id) {
        await mutate('POST', 'follow_up_queue', {
          lead_id: id,
          marketer_id: profile.id,
          follow_up_at: new Date(followUpDate).toISOString(),
          reason: actNote,
          priority: 'normal',
        })
      }

      toast.success('Activity logged!')
      setActNote(''); setActOutcome(''); setFollowUpDate('')
      load()
    } catch (e: any) {
      toast.error(e.message || 'Failed to log activity')
    } finally {
      setSavingAct(false)
    }
  }

  async function updateStatus() {
    if (!newStatus || newStatus === lead?.status) return
    // Registration must use the Register button (programme + points).
    if (newStatus === 'registered') {
      toast.info('Use "Register & earn points" to register this student')
      setRegOpen(true)
      return
    }
    try {
      const result = await changeLeadStatus(id, newStatus)
      if (result.error) { toast.error(result.error); return }
      if (newStatus === 'ready_to_join') {
        await fetch('/api/admissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json'},
          body: JSON.stringify({ leadId: id }),
        })
        toast.success('Status updated! Admissions team notified.')
      } else {
        toast.success('Status updated')
      }
      load()
    } catch (e: any) {
      toast.error(e.message || 'Failed to update status')
    }
  }

  async function sendQuickWA(template: string) {
    if (!lead?.phone) return
    const phone = lead.phone.replace(/^0/, '233').replace(/^\+/, '')
    const msg = template.replace('{{name}}', lead.full_name.split(' ')[0])
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank')
    // Log the activity
    try {
      await mutate('POST', 'lead_activities', {
        lead_id: id, activity_type: 'whatsapp',
        subject: 'WhatsApp sent', description: msg, created_by: profile?.id,
      })
      load()
    } catch {}
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
  if (!lead) return <div className="text-center py-20 text-[var(--ink-faint)]">Lead not found</div>

  const WA_TEMPLATES = [
    `Hello {{name}}! This is ${profile?.full_name?.split(' ')[0]} from Cambridge Centre of Excellence. I'm reaching out to follow up on your interest in our programs. Are you still interested? `,
    `Hi {{name}}! Just checking in from Cambridge CE. We have a new intake starting soon. Would you like to know more? `,
    `Hello {{name}}! I wanted to share something exciting — we have a special offer this month at Cambridge CE. Can I tell you more? `,
  ]

  return (
    <div className="fade-in w-full">
      <Link href="/marketer"className="inline-flex items-center gap-2 text-sm text-[var(--ink-faint)] hover:text-[var(--ink)] mb-5 transition">
        <ArrowLeft size={16} /> Back to my leads
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left col */}
        <div className="lg:col-span-2 space-y-4">
          {/* Lead card */}
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xl font-bold">
                  {lead.full_name.charAt(0)}
                </div>
                <div>
                  <h1 className="font-display text-xl font-semibold text-[var(--ink)]">{lead.full_name}</h1>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[lead.source]}`}>{lead.source}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[lead.status]}`}>{lead.status.replace(/_/g, ' ')}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              {[
                { icon: Phone, label: 'Phone', value: formatPhone(lead.phone), href: `tel:${lead.phone}` },
                { icon: Mail, label: 'Email', value: lead.email || '—', href: lead.email ? `mailto:${lead.email}` : undefined },
                { icon: Calendar, label: 'Added', value: formatDateTime(lead.created_at) },
                { icon: Clock, label: 'Last Update', value: formatDateTime(lead.updated_at) },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-2">
                  <item.icon size={14} className="text-[var(--ink-faint)] mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs text-[var(--ink-faint)]">{item.label}</div>
                    {item.href
                      ? <a href={item.href} className="font-medium text-[var(--accent)] hover:underline">{item.value}</a>
                      : <div className="font-medium text-[var(--ink)]">{item.value}</div>}
                  </div>
                </div>
              ))}
            </div>

            {lead.course_interest && (
              <div className="bg-[var(--accent-soft)] rounded-xl px-3 py-2 text-sm text-[var(--accent)] mb-4">
                 Interested in: <strong>{lead.course_interest}</strong>
              </div>
            )}

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2 pt-4 border-t border-[var(--line-soft)]">
              {lead.phone && (
                <>
                  <a href={`tel:${lead.phone}`}
                    className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition">
                    <Phone size={14} /> Call
                  </a>
                  <a href={`https://wa.me/${lead.phone.replace(/^0/, '233').replace(/^\+/, '')}`} target="_blank"
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#25D366] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition">
                    <MessageSquare size={14} /> WhatsApp
                  </a>
                </>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[var(--accent)] text-white rounded-xl text-sm font-semibold hover:brightness-110 transition">
                  <Mail size={14} /> Email
                </a>
              )}
            </div>
          </div>

          {/* Quick WhatsApp templates */}
          {lead.phone && (
            <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
              <h3 className="text-sm font-semibold text-[var(--ink)] mb-3">Quick WhatsApp Messages</h3>
              <div className="space-y-2">
                {WA_TEMPLATES.map((t, i) => (
                  <button key={i} onClick={() => sendQuickWA(t)}
                    className="w-full text-left p-3 bg-[var(--line-soft)] rounded-xl text-xs text-[var(--ink-soft)] hover:bg-[var(--ok-soft)] hover:text-[var(--ok)] hover:border-[var(--ok)]/20 border border-transparent transition line-clamp-2">
                    {t.replace('{{name}}', lead.full_name.split(' ')[0])}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Log activity */}
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
            <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Log Activity</h3>

            {/* Activity type */}
            <div className="flex flex-wrap gap-2 mb-4">
              {ACTIVITY_TYPES.map(t => (
                <button key={t.key} onClick={() => setActType(t.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border-2 transition ${actType === t.key ? 'border-blue-600 bg-[var(--accent-soft)] text-[var(--accent)]': 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--line)]'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <textarea value={actNote} onChange={e => setActNote(e.target.value)} rows={3}
                placeholder="What happened? What did you discuss?"
                className="w-full text-sm px-3 py-2.5 border border-[var(--line)] rounded-xl resize-none focus:outline-none focus:border-[var(--accent)]" />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[var(--ink-faint)] mb-1 block">Outcome</label>
                  <input value={actOutcome} onChange={e => setActOutcome(e.target.value)}
                    placeholder="e.g. Showed interest in PMP"
                    className="w-full h-10 px-3 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--ink-faint)] mb-1 block">Follow-up Date</label>
                  <input type="datetime-local" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
                </div>
              </div>

              <button onClick={logActivity} disabled={savingAct}
                className="w-full h-11 bg-[var(--accent)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110 transition flex items-center justify-center gap-2">
                <Plus size={16} />
                {savingAct ? 'Saving...': 'Log Activity'}
              </button>
            </div>
          </div>

          {/* Activity timeline */}
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
            <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Activity Timeline ({activities.length})</h3>
            {activities.length === 0 ? (
              <p className="text-sm text-[var(--ink-faint)] text-center py-6">No activities yet. Log your first interaction.</p>
            ) : (
              <div className="space-y-3">
                {activities.map(a => {
                  const at = ACTIVITY_TYPES.find(t => t.key === a.activity_type)
                  return (
                    <div key={a.id} className="flex gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs ${at?.color || 'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
                        {at?.label.split(' ')[0]}
                      </div>
                      <div className="flex-1 pb-3 border-b border-[var(--line-soft)] last:border-0">
                        <div className="text-sm font-semibold text-[var(--ink)]">{a.subject}</div>
                        {a.description && <div className="text-xs text-[var(--ink-soft)] mt-0.5">{a.description}</div>}
                        {a.outcome && <div className="text-xs text-[var(--accent)] mt-1 font-medium">Result: {a.outcome}</div>}
                        {a.next_follow_up && (
                          <div className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                            <Clock size={10} /> Follow up: {formatDateTime(a.next_follow_up)}
                          </div>
                        )}
                        <div className="text-[10px] text-[var(--ink-faint)] mt-1">{formatDateTime(a.created_at)} · {(a as any).creator?.full_name || 'You'}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right col */}
        <div className="space-y-4">
          {/* Register & earn points */}
          {lead.status !== 'registered' && (
            <div className="rounded-2xl bg-[var(--accent)] text-white p-5">
              <div className="flex items-center gap-2 text-white/70 text-[12px] mb-1.5">
                Convert this lead
              </div>
              <h3 className="font-display text-lg font-semibold mb-1">Register student</h3>
              <p className="text-white/70 text-sm mb-4">Mark as enrolled to earn points and your GHS 200 registration commission.</p>
              <button onClick={() => setRegOpen(true)}
                className="w-full h-10 bg-white text-[var(--accent)] rounded-lg text-sm font-semibold hover:bg-white/90 transition">
                Register &amp; earn points
              </button>
            </div>
          )}
          {lead.status === 'registered' && (
            <div className="rounded-2xl bg-[var(--ok-soft)] border border-[var(--ok)]/20 p-5 text-center">
              <div className="text-sm font-semibold text-[var(--ok)]">Registered</div>
              <div className="text-xs text-[var(--ok)] mt-1">Points have been credited to your annual total.</div>
            </div>
          )}

          {/* Update status */}
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
            <h3 className="text-sm font-semibold text-[var(--ink)] mb-3">Update Status</h3>
            <div className="space-y-2 mb-4">
              {STATUSES.map(s => (
                <button key={s.key} onClick={() => setNewStatus(s.key)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold border-2 transition ${
                    newStatus === s.key ? STATUS_COLORS[s.key] + 'border-current': 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--line)]'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
            <button onClick={updateStatus} disabled={newStatus === lead?.status}
              className="w-full h-10 bg-[var(--accent)] text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:brightness-110 transition">
              Update Status
            </button>
          </div>

          {/* Lead notes */}
          {lead.notes && (
            <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
              <h3 className="text-sm font-semibold text-[var(--ink)] mb-2">Notes</h3>
              <p className="text-sm text-[var(--ink-soft)]">{lead.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Register student modal */}
      <Modal open={regOpen} onClose={() => setRegOpen(false)} maxWidth="max-w-sm">
        <div className="p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">Register student</h2>
            <button onClick={() => setRegOpen(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"><Plus size={20} className="rotate-45" /></button>
          </div>
          <p className="text-sm text-[var(--ink-soft)] mb-5">{lead?.full_name}</p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">Programme</label>
              <select value={regForm.programCode} onChange={e => setRegForm({ ...regForm, programCode: e.target.value })}
                className="w-full h-11 px-3 rounded-lg border border-[var(--line)] text-sm bg-white focus:outline-none focus:border-[var(--accent)]">
                <option value="">Select programme</option>
                {programs.map((p: any) => (
                  <option key={p.code} value={p.code}>{p.name} {p.is_corporate ? '(40–200 pts)' : `(${p.points} pts)`}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">Delivery</label>
              <div className="grid grid-cols-2 gap-2">
                {[{ v: 'in_person', l: 'In person' }, { v: 'online', l: 'Online' }].map(d => (
                  <button key={d.v} type="button" onClick={() => setRegForm({ ...regForm, delivery: d.v })}
                    className={`h-10 rounded-lg text-sm font-medium border transition ${regForm.delivery === d.v ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink-faint)]'}`}>
                    {d.l}
                  </button>
                ))}
              </div>
            </div>

            {programs.find((p: any) => p.code === regForm.programCode)?.is_corporate && (
              <div>
                <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">Corporate value (points, 40–200)</label>
                <input type="number" min={40} max={200} value={regForm.corporateValue}
                  onChange={e => setRegForm({ ...regForm, corporateValue: e.target.value })}
                  placeholder="e.g. 120"
                  className="w-full h-11 px-3 rounded-lg border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
              </div>
            )}

            <div className="bg-[var(--accent-soft)] rounded-lg p-3 text-sm text-[var(--accent)]">
              This credits the points to your annual total plus GHS 200 registration commission, and marks the lead as registered.
            </div>
          </div>

          <div className="flex gap-2 mt-6">
            <button onClick={registerStudent} disabled={registering}
              className="flex-1 h-11 bg-[var(--accent)] text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:brightness-110 transition">
              {registering ? 'Registering…' : 'Confirm registration'}
            </button>
            <button onClick={() => setRegOpen(false)} className="px-4 h-11 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--ink-soft)]">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

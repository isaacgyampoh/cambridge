'use client'
import { useState, useEffect, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime, formatPhone, STATUS_COLORS, SOURCE_COLORS } from '@/lib/utils'
import { toast } from 'sonner'
import { ArrowLeft, Phone, MessageSquare, Mail, Calendar, Plus, Clock } from 'lucide-react'
import Link from 'next/link'

const STATUSES = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'interested', label: 'Interested' },
  { key: 'follow_up', label: 'Follow Up' },
  { key: 'ready_to_join', label: 'Ready to Join 🚀' },
  { key: 'not_interested', label: 'Not Interested' },
  { key: 'lost', label: 'Lost' },
]

const ACTIVITY_TYPES = [
  { key: 'call', label: '📞 Call', color: 'bg-green-100 text-green-700' },
  { key: 'whatsapp', label: '💬 WhatsApp', color: 'bg-emerald-100 text-emerald-700' },
  { key: 'email', label: '📧 Email', color: 'bg-blue-100 text-blue-700' },
  { key: 'meeting', label: '🤝 Meeting', color: 'bg-purple-100 text-purple-700' },
  { key: 'note', label: '📝 Note', color: 'bg-gray-100 text-gray-700' },
]

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
  const sb = createClient()

  useEffect(() => {
    async function init() {
      const { data: { user } } = await sb.auth.getUser()
      const { data: p } = await sb.from('profiles').select('*').eq('id', user!.id).single()
      setProfile(p)
      load()
    }
    init()
  }, [id])

  async function load() {
    const [{ data: l }, { data: a }] = await Promise.all([
      sb.from('leads').select('*').eq('id', id).single(),
      sb.from('lead_activities').select('*, creator:created_by(full_name)').eq('lead_id', id).order('created_at', { ascending: false }).limit(30),
    ])
    setLead(l); setActivities(a || [])
    setNewStatus(l?.status || '')
    setLoading(false)
  }

  async function logActivity() {
    if (!actNote.trim()) { toast.error('Add a note about this activity'); return }
    setSavingAct(true)

    await sb.from('lead_activities').insert({
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
      await sb.from('follow_up_queue').insert({
        lead_id: id,
        marketer_id: profile.id,
        follow_up_at: new Date(followUpDate).toISOString(),
        reason: actNote,
        priority: 'normal',
      })
    }

    toast.success('Activity logged!')
    setActNote(''); setActOutcome(''); setFollowUpDate('')
    setSavingAct(false)
    load()
  }

  async function updateStatus() {
    if (!newStatus || newStatus === lead?.status) return
    await sb.from('leads').update({ status: newStatus }).eq('id', id)
    if (newStatus === 'ready_to_join') {
      await fetch('/api/admissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: id }),
      })
      toast.success('Status updated! Admissions team notified.')
    } else {
      toast.success('Status updated')
    }
    load()
  }

  async function sendQuickWA(template: string) {
    if (!lead?.phone) return
    const phone = lead.phone.replace(/^0/, '233').replace(/^\+/, '')
    const msg = template.replace('{{name}}', lead.full_name.split(' ')[0])
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank')
    // Log the activity
    await sb.from('lead_activities').insert({
      lead_id: id, activity_type: 'whatsapp',
      subject: 'WhatsApp sent', description: msg, created_by: profile?.id,
    })
    load()
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
  if (!lead) return <div className="text-center py-20 text-gray-400">Lead not found</div>

  const WA_TEMPLATES = [
    `Hello {{name}}! This is ${profile?.full_name?.split(' ')[0]} from Cambridge Centre of Excellence. I'm reaching out to follow up on your interest in our programs. Are you still interested? 😊`,
    `Hi {{name}}! Just checking in from Cambridge CE. We have a new intake starting soon. Would you like to know more? 🎓`,
    `Hello {{name}}! I wanted to share something exciting — we have a special offer this month at Cambridge CE. Can I tell you more? 🚀`,
  ]

  return (
    <div className="fade-in max-w-5xl">
      <Link href="/marketer" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-5 transition">
        <ArrowLeft size={16} /> Back to my leads
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left col */}
        <div className="lg:col-span-2 space-y-4">
          {/* Lead card */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xl font-bold">
                  {lead.full_name.charAt(0)}
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{lead.full_name}</h1>
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
                  <item.icon size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs text-gray-400">{item.label}</div>
                    {item.href
                      ? <a href={item.href} className="font-medium text-blue-600 hover:underline">{item.value}</a>
                      : <div className="font-medium text-gray-900">{item.value}</div>}
                  </div>
                </div>
              ))}
            </div>

            {lead.course_interest && (
              <div className="bg-blue-50 rounded-xl px-3 py-2 text-sm text-blue-700 mb-4">
                📚 Interested in: <strong>{lead.course_interest}</strong>
              </div>
            )}

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-100">
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
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition">
                  <Mail size={14} /> Email
                </a>
              )}
            </div>
          </div>

          {/* Quick WhatsApp templates */}
          {lead.phone && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="text-sm font-bold text-gray-900 mb-3">Quick WhatsApp Messages</h3>
              <div className="space-y-2">
                {WA_TEMPLATES.map((t, i) => (
                  <button key={i} onClick={() => sendQuickWA(t)}
                    className="w-full text-left p-3 bg-gray-50 rounded-xl text-xs text-gray-600 hover:bg-green-50 hover:text-green-700 hover:border-green-200 border border-transparent transition line-clamp-2">
                    {t.replace('{{name}}', lead.full_name.split(' ')[0])}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Log activity */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-4">Log Activity</h3>

            {/* Activity type */}
            <div className="flex flex-wrap gap-2 mb-4">
              {ACTIVITY_TYPES.map(t => (
                <button key={t.key} onClick={() => setActType(t.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border-2 transition ${actType === t.key ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <textarea value={actNote} onChange={e => setActNote(e.target.value)} rows={3}
                placeholder="What happened? What did you discuss?"
                className="w-full text-sm px-3 py-2.5 border border-gray-200 rounded-xl resize-none focus:outline-none focus:border-blue-500" />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Outcome</label>
                  <input value={actOutcome} onChange={e => setActOutcome(e.target.value)}
                    placeholder="e.g. Showed interest in PMP"
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Follow-up Date</label>
                  <input type="datetime-local" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>

              <button onClick={logActivity} disabled={savingAct}
                className="w-full h-11 bg-blue-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:bg-blue-700 transition flex items-center justify-center gap-2">
                <Plus size={16} />
                {savingAct ? 'Saving...' : 'Log Activity'}
              </button>
            </div>
          </div>

          {/* Activity timeline */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-4">Activity Timeline ({activities.length})</h3>
            {activities.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No activities yet. Log your first interaction.</p>
            ) : (
              <div className="space-y-3">
                {activities.map(a => {
                  const at = ACTIVITY_TYPES.find(t => t.key === a.activity_type)
                  return (
                    <div key={a.id} className="flex gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs ${at?.color || 'bg-gray-100 text-gray-600'}`}>
                        {at?.label.split(' ')[0]}
                      </div>
                      <div className="flex-1 pb-3 border-b border-gray-50 last:border-0">
                        <div className="text-sm font-semibold text-gray-900">{a.subject}</div>
                        {a.description && <div className="text-xs text-gray-600 mt-0.5">{a.description}</div>}
                        {a.outcome && <div className="text-xs text-blue-600 mt-1 font-medium">Result: {a.outcome}</div>}
                        {a.next_follow_up && (
                          <div className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                            <Clock size={10} /> Follow up: {formatDateTime(a.next_follow_up)}
                          </div>
                        )}
                        <div className="text-[10px] text-gray-400 mt-1">{formatDateTime(a.created_at)} · {(a as any).creator?.full_name || 'You'}</div>
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
          {/* Update status */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Update Status</h3>
            <div className="space-y-2 mb-4">
              {STATUSES.map(s => (
                <button key={s.key} onClick={() => setNewStatus(s.key)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold border-2 transition ${
                    newStatus === s.key ? STATUS_COLORS[s.key] + ' border-current' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
            <button onClick={updateStatus} disabled={newStatus === lead?.status}
              className="w-full h-10 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-blue-700 transition">
              Update Status
            </button>
          </div>

          {/* Lead notes */}
          {lead.notes && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="text-sm font-bold text-gray-900 mb-2">Notes</h3>
              <p className="text-sm text-gray-600">{lead.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

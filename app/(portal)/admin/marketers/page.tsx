'use client'
import { useState, useEffect } from 'react'
import { mutate } from '@/hooks/useData'
import { formatDate, formatGHS } from '@/lib/utils'
import { AlertTriangle, TrendingUp, Phone, MessageSquare, Users, Target, Bell } from 'lucide-react'
import { toast } from 'sonner'
import Modal from '@/components/shared/Modal'

interface MarketerStats {
  id: string
  full_name: string
  email: string
  phone: string | null
  marketer_code: string | null
  // Lead stats
  totalLeads: number
  contactedLeads: number
  interestedLeads: number
  convertedLeads: number
  lostLeads: number
  uncontactedLeads: number
  conversionRate: number
  // Activity
  callsThisWeek: number
  waThisWeek: number
  lastActivityDate: string | null
  daysSinceActivity: number
  // Applications
  applicationsGenerated: number
  applicationsPaid: number
  revenueGenerated: number
  // Status
  status: 'active'| 'inactive'| 'at_risk'| 'top_performer'
}


async function apiQuery(table: string, select: string, filters?: { col: string; op: string; val: any }[], limit = 1000) {
  const params = new URLSearchParams({ table, select, limit: String(limit) })
  if (filters?.length) params.set('filters', JSON.stringify(filters))
  const res = await fetch(`/api/data?${params}`)
  const json = await res.json()
  return json.data || []
}

export default function MarketerPerformancePage() {
  const [marketers, setMarketers] = useState<MarketerStats[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('30')
  const [selected, setSelected] = useState<MarketerStats | null>(null)
  const [alertMsg, setAlertMsg] = useState('')
  const [sendingAlert, setSendingAlert] = useState(false)
  const [view, setView] = useState<'table'| 'cards'>('cards')
  useEffect(() => { load() }, [range])

  async function load() {
    setLoading(true)
    const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString()

    const profiles = await apiQuery('profiles', '*', [
      { col: 'role', op: 'eq', val: 'marketing_officer'},
      { col: 'is_active', op: 'eq', val: true },
    ])

    if (!profiles?.length) { setMarketers([]); setLoading(false); return }

    const stats: MarketerStats[] = []

    for (const m of profiles) {
      // Get all leads assigned to this marketer
      const leads = await apiQuery('leads', 'status,created_at,updated_at', [
        { col: 'assigned_to', op: 'eq', val: m.id },
      ])

      // Activities this week
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
      const activities = await apiQuery('lead_activities', 'activity_type,created_at', [
        { col: 'created_by', op: 'eq', val: m.id },
        { col: 'created_at', op: 'gte', val: weekAgo },
      ])

      // Applications via marketer link
      const applications = await apiQuery('applications', 'payment_status,amount_paid', [
        { col: 'marketer_id', op: 'eq', val: m.id },
        { col: 'created_at', op: 'gte', val: since },
      ])

      const l: any[] = leads
      const a: any[] = activities
      const apps: any[] = applications

      const converted = l.filter((x: any) => ['ready_to_join','registered'].includes(x.status)).length
      const total = l.length
      const lastActivity = a.length > 0
        ? a.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0].created_at
        : null
      const daysSince = lastActivity
        ? Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000)
        : 999

      const paidApps = apps.filter((a: any) => a.payment_status === 'paid')
      const revenue = paidApps.reduce((acc: number, a: any) => acc + Number(a.amount_paid), 0)

      let status: MarketerStats['status'] = 'active'
      const convRate = total > 0 ? Math.round(converted / total * 100) : 0
      if (daysSince > 7) status = 'inactive'
      else if (convRate > 30) status = 'top_performer'
      else if (daysSince > 3 || convRate < 5) status = 'at_risk'

      stats.push({
        id: m.id,
        full_name: m.full_name,
        email: m.email,
        phone: m.phone,
        marketer_code: m.marketer_code,
        totalLeads: total,
        contactedLeads: l.filter((x: any) => x.status !== 'new').length,
        interestedLeads: l.filter((x: any) => ['interested','follow_up'].includes(x.status)).length,
        convertedLeads: converted,
        lostLeads: l.filter((x: any) => ['not_interested','lost'].includes(x.status)).length,
        uncontactedLeads: l.filter((x: any) => x.status === 'new').length,
        conversionRate: convRate,
        callsThisWeek: a.filter((x: any) => x.activity_type === 'call').length,
        waThisWeek: a.filter((x: any) => x.activity_type === 'whatsapp').length,
        lastActivityDate: lastActivity,
        daysSinceActivity: daysSince,
        applicationsGenerated: apps.length,
        applicationsPaid: paidApps.length,
        revenueGenerated: revenue,
        status,
      })
    }

    // Sort: top performers first, then active, at risk, inactive
    const order = { top_performer: 0, active: 1, at_risk: 2, inactive: 3 }
    stats.sort((a, b) => order[a.status] - order[b.status] || b.conversionRate - a.conversionRate)
    setMarketers(stats)
    setLoading(false)
  }

  async function sendAlert(marketer: MarketerStats) {
    if (!alertMsg.trim()) { toast.error('Write a message first'); return }
    setSendingAlert(true)

    // In-app notification
    await mutate('POST', 'notifications', {
      user_id: marketer.id,
      type: 'system',
      title: 'Performance Alert from Management',
      body: alertMsg,
      data: { from: 'admin', type: 'performance_alert'},
    })

    // SMS if phone available
    if (marketer.phone) {
      await fetch('/api/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json'},
        body: JSON.stringify({ phone: marketer.phone, message: `CCE Management: ${alertMsg}` }),
      })
    }

    toast.success(`Alert sent to ${marketer.full_name}`)
    setAlertMsg('')
    setSendingAlert(false)
    setSelected(null)
  }

  const STATUS_CONFIG = {
    top_performer: { label: 'Top Performer', color: 'bg-[var(--warn-soft)] text-[var(--warn)] border-yellow-200', bg: 'border-yellow-300'},
    active: { label: 'Active', color: 'bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok)]/20', bg: 'border-[var(--ok)]/20'},
    at_risk: { label: 'At Risk', color: 'bg-[var(--warn-soft)] text-[var(--warn)] border-orange-200', bg: 'border-orange-300'},
    inactive: { label: 'Inactive', color: 'bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger)]/20', bg: 'border-red-300'},
  }

  const summary = {
    total: marketers.length,
    topPerformers: marketers.filter(m => m.status === 'top_performer').length,
    active: marketers.filter(m => m.status === 'active').length,
    atRisk: marketers.filter(m => m.status === 'at_risk').length,
    inactive: marketers.filter(m => m.status === 'inactive').length,
    totalLeads: marketers.reduce((a, m) => a + m.totalLeads, 0),
    totalConverted: marketers.reduce((a, m) => a + m.convertedLeads, 0),
    totalRevenue: marketers.reduce((a, m) => a + m.revenueGenerated, 0),
  }

  return (
    <div className="fade-in w-full">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-[13px] font-medium text-[var(--ink-faint)] mb-2">Team</div>
          <h1 className="font-display text-[28px] leading-tight font-semibold text-[var(--ink)]">Marketer performance</h1>
          <p className="text-[var(--ink-soft)] text-sm mt-1.5">Conversion, activity and revenue attributed to each marketer.</p>
        </div>
        <div className="flex gap-1 bg-[var(--line-soft)] rounded-lg p-1">
          {[{v:'7',l:'7d'},{v:'30',l:'30d'},{v:'90',l:'90d'}].map(r => (
            <button key={r.v} onClick={() => setRange(r.v)}
              className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition ${range === r.v ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--ink-faint)] hover:text-[var(--ink)]'}`}>
              {r.l}
            </button>
          ))}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Top performers', value: summary.topPerformers, tone: 'text-[var(--ok)]' },
          { label: 'Active', value: summary.active, tone: 'text-[var(--ink)]' },
          { label: 'At risk', value: summary.atRisk, tone: 'text-[var(--warn)]' },
          { label: 'Inactive', value: summary.inactive, tone: 'text-[var(--danger)]' },
        ].map(k => (
          <div key={k.label} className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
            <div className="text-[13px] font-medium text-[var(--ink-faint)]">{k.label}</div>
            <div className={`font-display text-[30px] leading-none font-semibold mt-3 ${k.tone}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Overall stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-[var(--accent)] rounded-xl p-5 text-white">
          <div className="text-[13px] font-medium text-white/70">Total leads</div>
          <div className="font-display text-[30px] leading-none font-semibold mt-3">{summary.totalLeads}</div>
        </div>
        <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
          <div className="text-[13px] font-medium text-[var(--ink-faint)]">Converted</div>
          <div className="font-display text-[30px] leading-none font-semibold mt-3 text-[var(--ink)]">{summary.totalConverted}</div>
          <div className="text-xs text-[var(--ink-faint)] mt-1.5">{summary.totalLeads ? Math.round(summary.totalConverted/summary.totalLeads*100) : 0}% conversion</div>
        </div>
        <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
          <div className="text-[13px] font-medium text-[var(--ink-faint)]">Revenue attributed</div>
          <div className="font-display text-[30px] leading-none font-semibold mt-3 text-[var(--ink)]">{formatGHS(summary.totalRevenue)}</div>
        </div>
      </div>

      {/* Alert modal */}
      {(
        <Modal open={!!selected} onClose={() => { setSelected(null); setAlertMsg('') }} maxWidth="max-w-sm">
          {selected && <div className="p-6">
            <h2 className="font-semibold text-[var(--ink)] mb-1">Send Alert to {selected.full_name.split(' ')[0]}</h2>
            <p className="text-sm text-[var(--ink-faint)] mb-4">This will send an in-app notification and SMS.</p>
            <div className="bg-orange-50 rounded-xl p-3 mb-4 text-xs text-[var(--warn)]">
              <strong>Performance snapshot:</strong><br />
              {selected.totalLeads} leads · {selected.convertedLeads} converted ({selected.conversionRate}%) · {selected.uncontactedLeads} uncontacted · Last active: {selected.daysSinceActivity === 999 ? 'Never': `${selected.daysSinceActivity} days ago`}
            </div>
            <textarea value={alertMsg} onChange={e => setAlertMsg(e.target.value)} rows={4}
              placeholder={`Hi ${selected.full_name.split(' ')[0]}, we noticed you have ${selected.uncontactedLeads} uncontacted leads...`}
              className="w-full text-sm px-3 py-2.5 border border-[var(--line)] rounded-xl resize-none focus:outline-none focus:border-[var(--accent)] mb-4" />
            {/* Quick templates */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {[
                `Hi ${selected.full_name.split(' ')[0]}, you have ${selected.uncontactedLeads} uncontacted leads. Please reach out to them today.`,
                `Hi ${selected.full_name.split(' ')[0]}, your conversion rate is ${selected.conversionRate}%. Let's discuss how we can improve this.`,
                `Hi ${selected.full_name.split(' ')[0]}, we haven't seen any activity in ${selected.daysSinceActivity} days. Please update your leads.`,
              ].map((t, i) => (
                <button key={i} onClick={() => setAlertMsg(t)}
                  className="text-[10px] px-2 py-1 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-lg hover:bg-[var(--line)] transition text-left">
                  Template {i + 1}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => sendAlert(selected)} disabled={sendingAlert || !alertMsg.trim()}
                className="flex-1 h-11 bg-orange-500 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-orange-600 transition flex items-center justify-center gap-2">
                
                {sendingAlert ? 'Sending...': 'Send Alert'}
              </button>
              <button onClick={() => { setSelected(null); setAlertMsg('') }}
                className="flex-1 h-11 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold">Cancel</button>
            </div>
          </div>}
        </Modal>
      )}

      {/* Marketer cards */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full spin" /></div>
      ) : (
        <div className="space-y-4">
          {marketers.map(m => {
            const sc = STATUS_CONFIG[m.status]
            return (
              <div key={m.id} className={`bg-[var(--paper)] rounded-xl border-2 p-5 transition ${sc.bg}`}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-[var(--accent)] flex items-center justify-center text-white font-bold flex-shrink-0">
                      {m.full_name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold text-[var(--ink)]">{m.full_name}</div>
                      <div className="text-xs text-[var(--ink-faint)]">{m.email}</div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border mt-1 inline-block ${sc.color}`}>{sc.label}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.status === 'inactive'&& (
                      <div className="text-xs font-bold text-[var(--danger)] bg-[var(--danger-soft)] px-3 py-1 rounded-full">
                        {m.daysSinceActivity === 999 ? 'Never active': `${m.daysSinceActivity} days idle`}
                      </div>
                    )}
                    <button onClick={() => setSelected(m)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-[var(--warn-soft)] text-[var(--warn)] rounded-xl text-xs font-semibold hover:bg-orange-200 transition">
                       Alert
                    </button>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
                  {[
                    { label: 'Total Leads', value: m.totalLeads, icon: Users },
                    { label: 'Uncontacted', value: m.uncontactedLeads, icon: AlertTriangle, alert: m.uncontactedLeads > 5 },
                    { label: 'Converted', value: m.convertedLeads, icon: TrendingUp },
                    { label: 'Rate', value: `${m.conversionRate}%`, icon: Target },
                    { label: 'Calls/wk', value: m.callsThisWeek, icon: Phone },
                    { label: 'WA/wk', value: m.waThisWeek, icon: MessageSquare },
                  ].map(s => (
                    <div key={s.label} className={`rounded-xl p-3 text-center ${(s as any).alert ? 'bg-[var(--danger-soft)]': 'bg-[var(--line-soft)]'}`}>
                      <div className={`text-xl font-bold ${(s as any).alert ? 'text-[var(--danger)]': 'text-[var(--ink)]'}`}>{s.value}</div>
                      <div className="text-[10px] text-[var(--ink-faint)] mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Progress bars */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[var(--ink-faint)]">Lead Pipeline</span>
                      <span className="font-semibold text-[var(--ink-soft)]">{m.totalLeads} leads</span>
                    </div>
                    <div className="h-2 bg-[var(--line-soft)] rounded-full overflow-hidden flex">
                      {m.totalLeads > 0 && <>
                        <div className="h-full bg-[var(--ok)]"style={{ width: `${m.convertedLeads/m.totalLeads*100}%` }} title="Converted" />
                        <div className="h-full bg-[var(--accent)]"style={{ width: `${m.interestedLeads/m.totalLeads*100}%` }} title="Interested" />
                        <div className="h-full bg-yellow-400"style={{ width: `${m.contactedLeads/m.totalLeads*100}%` }} title="Contacted" />
                        <div className="h-full bg-[var(--line)]"style={{ width: `${m.uncontactedLeads/m.totalLeads*100}%` }} title="New/Uncontacted" />
                      </>}
                    </div>
                    <div className="flex gap-3 mt-1">
                      {[
                        { color: 'bg-[var(--ok)]', label: 'Converted'},
                        { color: 'bg-[var(--accent)]', label: 'Interested'},
                        { color: 'bg-yellow-400', label: 'Contacted'},
                        { color: 'bg-[var(--line)]', label: 'New'},
                      ].map(l => (
                        <div key={l.label} className="flex items-center gap-1 text-[9px] text-[var(--ink-faint)]">
                          <div className={`w-2 h-2 rounded-full ${l.color}`} />
                          {l.label}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="text-xs text-[var(--ink-faint)] flex items-center gap-4">
                    <div>
                      <div className="font-semibold text-[var(--ink)]">{m.applicationsGenerated}</div>
                      <div>Applications</div>
                    </div>
                    <div>
                      <div className="font-bold text-[var(--ok)]">{m.applicationsPaid}</div>
                      <div>Paid</div>
                    </div>
                    <div>
                      <div className="font-bold text-[var(--ok)]">{formatGHS(m.revenueGenerated)}</div>
                      <div>Revenue</div>
                    </div>
                    {m.lastActivityDate && (
                      <div>
                        <div className="font-semibold text-[var(--ink-soft)]">{m.daysSinceActivity === 0 ? 'Today': `${m.daysSinceActivity}d ago`}</div>
                        <div>Last Active</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {marketers.length === 0 && !loading && (
            <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-16 text-center text-[var(--ink-faint)]">
              
              <p>No marketing officers found</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

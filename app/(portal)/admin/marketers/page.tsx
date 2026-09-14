'use client'
import { useState, useEffect, useCallback } from 'react'
import { mutate } from '@/hooks/useData'
import { formatGHS } from '@/lib/utils'
import { toast } from 'sonner'
import Modal from '@/components/shared/Modal'
import { Card, EmptyState, LoadingState, ErrorState, PageHeader } from '@/components/ui'
import { apiQuery, ApiQueryError } from '@/lib/api/query'
import { postJson, messageFor } from '@/lib/api/post'

interface MarketerStats {
  id: string
  full_name: string
  email: string
  phone: string | null
  marketer_code: string
  performance_tier?: string
  gets_google_leads?: boolean
  gets_website_leads?: boolean
  tier_locked?: boolean | null
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

/** The rows this page reads, named so the reads below are checked. */
type MarketerProfile = {
  id: string
  full_name: string
  email: string
  phone: string | null
  marketer_code: string
  performance_tier?: string | null
  tier_locked?: boolean | null
  gets_google_leads?: boolean | null
  gets_website_leads?: boolean | null
}
type LeadRow = { status: string; created_at: string; updated_at: string }
type ActivityRow = { activity_type: string; created_at: string }
type ApplicationRow = { payment_status: string; amount_paid: number | string | null }

export default function MarketerPerformancePage() {
  const [marketers, setMarketers] = useState<MarketerStats[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('30')
  const [selected, setSelected] = useState<MarketerStats | null>(null)
  const [alertMsg, setAlertMsg] = useState('')
  const [sendingAlert, setSendingAlert] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Marketing-link performance. Null until loaded; never faked as zeroes. */
  type LinkRow = { name: string; code: string; visits: number | null; leads: number }
  const [links, setLinks] = useState<{ rows: LinkRow[]; countingVisits: boolean } | null>(null)

  useEffect(() => {
    fetch('/api/marketing/overview')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setLinks(d) })
      .catch(() => {})
  }, [])

  /*
   * useCallback so the effect's dependency is real rather than silenced.
   *
   * The effect listed the value the loader reads but not the loader itself,
   * so the relationship was correct by coincidence: it held only because the
   * function is redefined every render. A future edit that captured anything
   * else would go stale with nothing to say so.
   */
  const load = useCallback(async () => {
    setLoading(true)
    const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString()
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()

    /*
     * ── WHY THIS IS NOT A LOOP OF AWAITS ANY MORE ────────────────────────
     *
     * It used to walk the marketers one at a time and, for each, await three
     * queries in sequence: leads, then activities, then applications. Nothing
     * in the second depended on the first — they were serial only because
     * that is how the code was written. With ten marketers that is thirty-one
     * round trips end to end, and the board sat empty for all of them.
     *
     * They all go out together now. The arithmetic below is unchanged.
     *
     * ── AND WHY IT IS WRAPPED ────────────────────────────────────────────
     *
     * apiQuery throws rather than returning [] on a failed request. Before,
     * an expired session drew this page as a board on which every marketer
     * had zero leads, zero calls and no revenue — which reads as a team that
     * did nothing, not as a page that failed.
     */
    try {
      const profiles = await apiQuery<MarketerProfile>('profiles', '*', {
        filters: [
          { col: 'role', op: 'eq', val: 'marketing_officer' },
          { col: 'is_active', op: 'eq', val: true },
        ],
        limit: 1000,
      })

      if (!profiles.length) { setMarketers([]); setError(null); setLoading(false); return }

      const stats = await Promise.all(profiles.map(async (m): Promise<MarketerStats> => {
        const [leads, activities, applications] = await Promise.all([
          apiQuery<LeadRow>('leads', 'status,created_at,updated_at', {
            filters: [{ col: 'assigned_to', op: 'eq', val: m.id }], limit: 1000,
          }),
          apiQuery<ActivityRow>('lead_activities', 'activity_type,created_at', {
            filters: [
              { col: 'created_by', op: 'eq', val: m.id },
              { col: 'created_at', op: 'gte', val: weekAgo },
            ], limit: 1000,
          }),
          apiQuery<ApplicationRow>('applications', 'payment_status,amount_paid', {
            filters: [
              { col: 'marketer_id', op: 'eq', val: m.id },
              { col: 'created_at', op: 'gte', val: since },
            ], limit: 1000,
          }),
        ])

        const converted = leads.filter(x => ['ready_to_join', 'registered'].includes(x.status)).length
        const total = leads.length

        /*
         * `reduce` rather than sort-then-take-first: the sort was mutating
         * the activities array in place to read one value out of it.
         */
        const lastActivity = activities.reduce<string | null>(
          (latest, x) => !latest || new Date(x.created_at) > new Date(latest) ? x.created_at : latest,
          null,
        )
        const daysSince = lastActivity
          ? Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000)
          : 999

        const paidApps = applications.filter(a => a.payment_status === 'paid')
        const revenue = paidApps.reduce((acc, a) => acc + Number(a.amount_paid || 0), 0)

        let status: MarketerStats['status'] = 'active'
        const convRate = total > 0 ? Math.round(converted / total * 100) : 0
        if (daysSince > 7) status = 'inactive'
        else if (convRate > 30) status = 'top_performer'
        else if (daysSince > 3 || convRate < 5) status = 'at_risk'

        return {
          id: m.id,
          full_name: m.full_name,
          email: m.email,
          phone: m.phone,
          marketer_code: m.marketer_code,
          performance_tier: m.performance_tier || 'mid',
          tier_locked: m.tier_locked || false,
          gets_google_leads: m.gets_google_leads === true,
          gets_website_leads: m.gets_website_leads === true,
          totalLeads: total,
          contactedLeads: leads.filter(x => x.status !== 'new').length,
          interestedLeads: leads.filter(x => ['interested', 'follow_up'].includes(x.status)).length,
          convertedLeads: converted,
          lostLeads: leads.filter(x => ['not_interested', 'lost'].includes(x.status)).length,
          uncontactedLeads: leads.filter(x => x.status === 'new').length,
          conversionRate: convRate,
          callsThisWeek: activities.filter(x => x.activity_type === 'call').length,
          waThisWeek: activities.filter(x => x.activity_type === 'whatsapp').length,
          lastActivityDate: lastActivity,
          daysSinceActivity: daysSince,
          applicationsGenerated: applications.length,
          applicationsPaid: paidApps.length,
          revenueGenerated: revenue,
          status,
        }
      }))

      // Sort: top performers first, then active, at risk, inactive
      const order = { top_performer: 0, active: 1, at_risk: 2, inactive: 3 }
      stats.sort((a, b) => order[a.status] - order[b.status] || b.conversionRate - a.conversionRate)
      setMarketers(stats)
      setError(null)
    } catch (e) {
      setMarketers([])
      setError(e instanceof ApiQueryError ? e.userMessage : 'This board could not be loaded. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { load() }, [load])

  async function sendAlert(marketer: MarketerStats) {
    if (!alertMsg.trim()) { toast.error('Write a message first'); return }
    setSendingAlert(true)

    /*
     * ── TWO SENDS, REPORTED SEPARATELY ───────────────────────────────────
     *
     * Neither of these was checked. mutate() does throw, but nothing caught
     * it, so a refused notification became an unhandled rejection and the
     * toast below never ran at all — the dialog simply sat there. The SMS was
     * a bare fetch, which does not throw, so a failed text was folded into
     * "Alert sent to <name>".
     *
     * They are different deliveries and they fail independently: the person
     * may have no phone on file, or the SMS balance may be out, while the
     * in-app notification is fine. Saying "alert sent" for a text that was
     * never sent is how a manager comes to believe a marketer has been warned.
     */
    let inApp = false
    try {
      await mutate('POST', 'notifications', {
        user_id: marketer.id,
        type: 'system',
        title: 'Performance Alert from Management',
        body: alertMsg,
        data: { from: 'admin', type: 'performance_alert' },
      })
      inApp = true
    } catch (e) {
      toast.error(messageFor(e, 'That alert could not be delivered to their portal.'))
    }

    let sms: 'sent' | 'failed' | 'no-number' = 'no-number'
    if (marketer.phone) {
      try {
        await postJson('/api/sms',
          { phone: marketer.phone, message: `CCE Management: ${alertMsg}` },
          { fallback: 'The text message could not be sent.' })
        sms = 'sent'
      } catch (e) {
        sms = 'failed'
        toast.error(messageFor(e, 'The text message could not be sent.'))
      }
    }

    if (inApp || sms === 'sent') {
      const first = marketer.full_name.split(' ')[0]
      toast.success(
        sms === 'sent' ? `Alert sent to ${first} in the portal and by text.`
        : sms === 'failed' ? `${first} has the alert in their portal, but the text did not go.`
        : `Alert sent to ${first} in the portal. No phone number on file to text.`,
      )
      setAlertMsg('')
      setSelected(null)
    }

    setSendingAlert(false)
  }

  const STATUS_CONFIG = {
    top_performer: { label: 'Top Performer', color: 'bg-[var(--warn-soft)] text-[var(--warn)] border-yellow-200', bg: 'border-yellow-300'},
    active: { label: 'Active', color: 'bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok)]/20', bg: 'border-[var(--ok)]/20'},
    at_risk: { label: 'At Risk', color: 'bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn-soft)]', bg: 'border-[var(--warn)]'},
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
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Team"
        title="Marketer performance"
        description="Conversion, activity and revenue attributed to each marketer."
        actions={
        <div className="flex gap-1 bg-[var(--line-soft)] rounded-lg p-1">
          {[{v:'7',l:'7d'},{v:'30',l:'30d'},{v:'90',l:'90d'}].map(r => (
            <button key={r.v} onClick={() => setRange(r.v)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition ${range === r.v ? 'bg-[var(--paper)] text-[var(--ink)] shadow-[var(--shadow-raised)]' : 'text-[var(--ink-faint)] hover:text-[var(--ink)]'}`}>
              {r.l}
            </button>
          ))}
        </div>
        }
      />

      {/*
        Marketing links.

        Placed here rather than on a screen of its own: the question "whose
        links are working" belongs beside "who is converting", and an
        administrator should not have to know these are different systems.
      */}
      {links && links.rows.length > 0 && (
        <Card className="p-4 sm:p-5 mb-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[14px] font-semibold text-[var(--ink)]">Marketing links</h2>
            {!links.countingVisits && (
              <span className="text-[11px] text-[var(--ink-faint)]">Opens not counted yet</span>
            )}
          </div>

          <div className="mt-3 -mx-1 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[var(--ink-faint)]">
                  <th className="text-left font-medium py-1.5 px-1">Staff</th>
                  <th className="text-right font-medium py-1.5 px-1">Opened</th>
                  <th className="text-right font-medium py-1.5 px-1">Leads</th>
                </tr>
              </thead>
              <tbody>
                {links.rows.map(r => (
                  <tr key={r.code} className="border-t border-[var(--line-soft)]">
                    <td className="py-2 px-1 text-[var(--ink)]">{r.name}</td>
                    <td className="py-2 px-1 text-right tabular-nums text-[var(--ink-soft)]">
                      {r.visits === null ? '—' : r.visits}
                    </td>
                    <td className="py-2 px-1 text-right tabular-nums font-medium text-[var(--ink)]">
                      {r.leads}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Top performers', value: summary.topPerformers, tone: 'text-[var(--ok)]' },
          { label: 'Active', value: summary.active, tone: 'text-[var(--ink)]' },
          { label: 'At risk', value: summary.atRisk, tone: 'text-[var(--warn)]' },
          { label: 'Inactive', value: summary.inactive, tone: 'text-[var(--danger)]' },
        ].map(k => (
          <div key={k.label} className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
            <div className="text-[13px] font-medium text-[var(--ink-faint)]">{k.label}</div>
            <div className={`font-display text-[24px] leading-none font-semibold mt-3 ${k.tone}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Overall stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-[var(--accent)] rounded-xl p-5 text-white">
          <div className="text-[13px] font-medium text-white/70">Total leads</div>
          <div className="font-display text-[24px] leading-none font-semibold mt-3">{summary.totalLeads}</div>
        </div>
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
          <div className="text-[13px] font-medium text-[var(--ink-faint)]">Converted</div>
          <div className="font-display text-[24px] leading-none font-semibold mt-3 text-[var(--ink)]">{summary.totalConverted}</div>
          <div className="text-xs text-[var(--ink-faint)] mt-1.5">{summary.totalLeads ? Math.round(summary.totalConverted/summary.totalLeads*100) : 0}% conversion</div>
        </div>
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
          <div className="text-[13px] font-medium text-[var(--ink-faint)]">Revenue attributed</div>
          <div className="font-display text-[24px] leading-none font-semibold mt-3 text-[var(--ink)]">{formatGHS(summary.totalRevenue)}</div>
        </div>
      </div>

      {/* Alert modal */}
      {(
        <Modal open={!!selected} onClose={() => { setSelected(null); setAlertMsg('') }} maxWidth="max-w-sm">
          {selected && <div className="p-6">
            <h2 className="font-semibold text-[var(--ink)] mb-1">Send Alert to {selected.full_name.split(' ')[0]}</h2>
            <p className="text-sm text-[var(--ink-faint)] mb-4">This will send an in-app notification and SMS.</p>
            <div className="bg-[var(--warn-soft)] rounded-xl p-3 mb-4 text-xs text-[var(--warn)]">
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
                  className="text-[11px] px-2 py-1 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-lg hover:bg-[var(--line)] transition text-left">
                  Template {i + 1}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => sendAlert(selected)} disabled={sendingAlert || !alertMsg.trim()}
                className="flex-1 h-11 bg-[var(--warn)] text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-[var(--warn)] transition flex items-center justify-center gap-2">
                
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
        <LoadingState />
      ) : error ? (
        /*
         * Before the empty check, deliberately. A failed load left `marketers`
         * empty, which fell through to "No marketing officers" — a sentence
         * about the team when the truth was about the request.
         */
        <ErrorState title="The board did not load" message={error} onRetry={load} />
      ) : (
        <div className="space-y-4">
      {/* How leads are shared — so the tiers are not misread */}
      <div className="bg-[var(--accent-soft)] border border-[var(--accent)]/15 rounded-xl p-4 mb-5">
        <div className="text-[13px] font-semibold text-[var(--ink)] mb-1.5">How shared leads are split</div>
        <p className="text-[12px] text-[var(--ink-soft)] leading-relaxed">
          Leads nobody introduced are shared by weight. Each <b>high performer counts 45</b>,
          each <b>mid 35</b>, each <b>low or support 20</b>. So a high performer receives about
          1.3 leads for every 1 a mid performer gets, and 2.25 for every 1 a low performer gets.
          Adding someone to a tier does not reduce anyone else’s weight. Leads from a
          marketer’s own link are never shared.
        </p>
      </div>

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
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border mt-1 inline-block ${sc.color}`}>{sc.label}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select value={m.performance_tier || 'mid'}
                      onChange={async (e) => {
                        const tier = e.target.value
                        /*
                         * The response is read now. It used to await the fetch
                         * and announce success regardless — so a 403 from a
                         * role that cannot set tiers, or a 500, told the
                         * administrator the change had been made. Tier decides
                         * who receives which leads, so being wrong about it is
                         * a question of money, not of tidiness.
                         */
                        const res = await fetch('/api/marketer/set-tier', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marketer_id: m.id, tier }) })
                        const d = await res.json().catch(() => null)
                        if (!res.ok || d?.error) {
                          toast.error(d?.error || 'That tier could not be saved.')
                          return
                        }
                        toast.success(`${m.full_name.split(' ')[0]} set to ${tier} performer`)
                        load()
                      }}
                      className={`text-[12px] font-semibold rounded-lg border px-2 py-1.5 ${
                        m.performance_tier === 'high' ? 'bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok)]/20' :
                        m.performance_tier === 'low' ? 'bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn)]/20' :
                        m.performance_tier === 'support' ? 'bg-[var(--line-soft)] text-[var(--ink-soft)] border-[var(--line)]' :
                        'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/20'
                      }`}>
                      <option value="high">High performer</option>
                      <option value="mid">Mid performer</option>
                      <option value="low">Low performer</option>
                      <option value="support">Support</option>
                    </select>
                    {/* Exclusive lead sources — Google & Website go only to
                        chosen people, not the whole pool */}
                    {(['google', 'website'] as const).map(src => {
                      const key = src === 'google' ? 'gets_google_leads' as const : 'gets_website_leads' as const
                      const on = m[key] === true
                      return (
                        <button key={src} title={`${on ? 'Receiving' : 'Not receiving'} ${src} leads`}
                          onClick={async () => {
                            /*
                             * Two things were wrong on this line.
                             *
                             * The fetch was awaited and its result thrown
                             * away, so a refusal — a role without permission,
                             * a server error — still announced that the
                             * marketer now receives Google leads. Google and
                             * website leads go to chosen people rather than
                             * the pool, so a false confirmation here sends an
                             * administrator away believing they have routed
                             * leads that are still going somewhere else.
                             *
                             * And `(m as any)[key] = !on` wrote into an object
                             * held in React state. Mutating state in place
                             * schedules no render, so it changed nothing on
                             * screen; the load() underneath is what actually
                             * refreshed the button. It was invisible work that
                             * left a wrong value behind whenever load() failed.
                             */
                            const res = await fetch('/api/marketer/set-source-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marketer_id: m.id, source: src, enabled: !on }) })
                            const d = await res.json().catch(() => null)
                            if (!res.ok || d?.error) {
                              toast.error(d?.error || 'That change could not be saved.')
                              return
                            }
                            toast.success(`${m.full_name.split(' ')[0]} ${!on ? 'now gets' : 'no longer gets'} ${src === 'google' ? 'Google' : 'Website'} leads`)
                            load()
                          }}
                          className={`text-[11px] font-semibold rounded-lg border px-2 py-1.5 transition ${
                            on ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'bg-[var(--paper)] text-[var(--ink-faint)] border-[var(--line)] hover:border-[var(--ink-faint)]'
                          }`}>
                          {src === 'google' ? 'Google' : 'Website'}
                        </button>
                      )
                    })}
                    {m.status === 'inactive'&& (
                      <div className="text-xs font-bold text-[var(--danger)] bg-[var(--danger-soft)] px-3 py-1 rounded-full">
                        {m.daysSinceActivity === 999 ? 'Never active': `${m.daysSinceActivity} days idle`}
                      </div>
                    )}
                    <button onClick={() => setSelected(m)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-[var(--warn-soft)] text-[var(--warn)] rounded-xl text-xs font-semibold hover:bg-[var(--warn-soft)] transition">
                       Alert
                    </button>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
                  {/*
                    * Annotated so `alert` is optional on every cell rather
                    * than present on one. Without it TypeScript infers a
                    * union in which only the Uncontacted cell has the field,
                    * which is why every read of it was cast through `any` —
                    * and each `icon` was dead weight: nothing below renders
                    * one.
                    */}
                  {([
                    { label: 'Total Leads', value: m.totalLeads },
                    { label: 'Uncontacted', value: m.uncontactedLeads, alert: m.uncontactedLeads > 5 },
                    { label: 'Converted', value: m.convertedLeads },
                    { label: 'Rate', value: `${m.conversionRate}%` },
                    { label: 'Calls/wk', value: m.callsThisWeek },
                    { label: 'WA/wk', value: m.waThisWeek },
                  ] as { label: string; value: string | number; alert?: boolean }[]).map(s => (
                    <div key={s.label} className={`rounded-xl p-3 text-center ${s.alert ? 'bg-[var(--danger-soft)]': 'bg-[var(--line-soft)]'}`}>
                      <div className={`text-xl font-bold ${s.alert ? 'text-[var(--danger)]': 'text-[var(--ink)]'}`}>{s.value}</div>
                      <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">{s.label}</div>
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
                        <div key={l.label} className="flex items-center gap-1 text-[11px] text-[var(--ink-faint)]">
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
            <Card>
              <EmptyState
                title="No marketing officers"
                description="Staff with the marketing officer role will be listed here."
              />
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

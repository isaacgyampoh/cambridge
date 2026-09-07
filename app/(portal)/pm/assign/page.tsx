'use client'
import { useState } from 'react'
import { displayPhone } from '@/lib/ui/contact'
import { useData } from '@/hooks/useData'
import { toast } from 'sonner'
import { SOURCE_COLORS, STATUS_COLORS } from '@/lib/utils'
import { Users, TrendingUp, UserCheck, Clock, RefreshCw, Search } from 'lucide-react'
import Link from 'next/link'
import { Card, Badge, SectionLabel } from '@/components/ui'
import { DataTable, type Column } from '@/components/ui/DataTable'
import type { LeadActivity } from '@/types'

type Lead = {
  id: string
  full_name: string
  phone?: string | null
  email?: string | null
  source: string
  course_interest?: string | null
  status: string
  created_at: string
  assignee?: { full_name?: string } | null
}

export default function PMAssign() {
  const [filter, setFilter] = useState<'unassigned'|'all'|'today'>('unassigned')
  const [assigning, setAssigning] = useState<string|null>(null)
  const [search, setSearch] = useState('')

  const { data: leads, loading, state, refetch } = useData({
    table: 'leads',
    select: '*, assignee:assigned_to(full_name, email)',
    orderBy: 'created_at', limit: 300,
  })

  const { data: marketers } = useData({
    table: 'profiles',
    select: 'id, full_name, email, phone',
    // Was filtered to role = marketing_officer, so a PM could not assign to an
    // admissions officer, coordinator or trainer who legitimately works leads.
    // Eligibility is the my_leads portal, not one role name.
    filters: [{ col: 'is_active', op: 'eq', val: true }],
    orderBy: 'full_name', orderAsc: true,
  })

  // Recent marketer notes/status-comments — the "why" behind each move
  const { data: activities } = useData<LeadActivity>({
    table: 'lead_activities',
    select: '*, lead:lead_id(full_name), author:created_by(full_name)',
    filters: [{ col: 'activity_type', op: 'eq', val: 'note' }],
    orderBy: 'created_at', orderAsc: false, limit: 25,
  })

  async function assignLead(leadId: string, marketerId: string) {
    if (!marketerId) return
    setAssigning(leadId)
    try {
      /*
       * ── WHY THERE IS NO PATCH HERE ANY MORE ──────────────────────────
       *
       * This used to write leads.assigned_to directly through /api/data and
       * THEN call /api/leads/assign. Doing both is what stopped every
       * notification.
       *
       * assign_lead_to ends with
       *
       *     IF v_current IS NOT DISTINCT FROM p_marketer THEN
       *       RETURN FALSE;   -- already theirs; nothing to record
       *
       * The PATCH had just made the lead theirs, so the RPC returned false,
       * the route answered 409, and everything after that early return never
       * ran: the SMS to the marketer, the WhatsApp to the lead, the audit
       * entry, the lead_activities row, and onLeadAssigned — which is what
       * increments the pending-SMS counter and writes the in-app
       * notification.
       *
       * The 409 was discarded, and the operator was told
       * "Lead assigned! Marketer notified via SMS & WhatsApp."
       *
       * Nobody was notified, ever, by either of these two screens.
       *
       * The PATCH also bypassed isEligible(), so a lead could be handed to
       * somebody with no leads portal — assigned correctly, and invisible to
       * them.
       *
       * The route does the whole job: eligibility, the locked write, the
       * history row, the notifications. Its answer is read.
       */
      const res = await fetch('/api/leads/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, marketerId }),
      })
      const d = await res.json().catch(() => null)

      if (!res.ok || !d?.success) {
        toast.error(d?.error || 'That lead could not be assigned. Please try again.')
        refetch()   // someone else may hold it now; show the truth
        return
      }

      toast.success('Lead assigned. The marketer has been notified.')
      refetch()
    } catch {
      toast.error('We could not reach the server. Check your connection and try again.')
    } finally {
      setAssigning(null)
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const stats = {
    total: leads.length,
    unassigned: leads.filter(l => !l.assigned_to).length,
    today: leads.filter(l => l.created_at?.startsWith(today)).length,
    readyToJoin: leads.filter(l => l.status === 'ready_to_join').length,
  }

  const filtered = leads.filter(l => {
    const matchFilter = filter === 'all' ? true : filter === 'unassigned' ? !l.assigned_to : l.created_at?.startsWith(today)
    const matchSearch = !search || l.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      l.phone?.includes(search) || l.email?.toLowerCase().includes(search.toLowerCase())
    return matchFilter && matchSearch
  })

  /*
   * Described once, rendered as a table on a desktop and as cards on a phone.
   * The screen previously rendered a seven-column grid inside overflow-x-auto,
   * which on a 375px screen means dragging sideways to read one lead.
   */
  const leadColumns: Column<Lead>[] = [
    {
      key: 'name', header: 'Lead', primary: true,
      render: l => (
        <Link href={`/pm/leads/${l.id}`}
          className="font-semibold text-[var(--accent)] hover:underline
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded">
          {l.full_name}
        </Link>
      ),
    },
    {
      key: 'contact', header: 'Contact', secondary: true,
      render: l => (
        <>
          <div>{displayPhone(l.phone) || '—'}</div>
          {l.email && <div className="text-[var(--ink-faint)] text-[12px]">{l.email}</div>}
        </>
      ),
    },
    {
      key: 'source', header: 'Source',
      render: l => (
        <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full capitalize
          ${SOURCE_COLORS[l.source] || 'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
          {l.source}
        </span>
      ),
    },
    {
      key: 'course', header: 'Course',
      render: l => <span className="text-[var(--ink-soft)]">{l.course_interest || '—'}</span>,
    },
    {
      key: 'status', header: 'Status',
      render: l => (
        <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full
          ${STATUS_COLORS[l.status] || 'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
          {l.status?.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'assign', header: 'Assign to',
      render: l => l.assignee ? (
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-[var(--accent)] grid place-items-center text-white text-[11px] font-bold shrink-0">
            {l.assignee.full_name?.charAt(0)}
          </span>
          <span className="text-[var(--ink-soft)]">{l.assignee.full_name?.split(' ')[0]}</span>
        </span>
      ) : (
        <select
          onChange={e => { if (e.target.value) assignLead(l.id, e.target.value) }}
          disabled={assigning === l.id} defaultValue=""
          aria-label={`Assign ${l.full_name} to a member of staff`}
          className="text-[13px] min-h-[40px] px-2 border border-[var(--line)] rounded-lg
            bg-[var(--paper)] w-full max-w-[190px] disabled:opacity-50
            focus:outline-none focus:border-[var(--accent)]">
          <option value="" disabled>Assign to…</option>
          {marketers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        </select>
      ),
    },
    {
      key: 'created', header: 'Added',
      render: l => (
        <span className="text-[var(--ink-faint)] text-[12px]">
          {new Date(l.created_at).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}
        </span>
      ),
    },
  ]

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-[13px] font-medium text-[var(--ink-faint)] mb-2">Pipeline</div>
          <h1 className="font-display text-[24px] leading-tight font-semibold text-[var(--ink)]">Lead inbox</h1>
          <p className="text-[var(--ink-soft)] text-sm mt-1.5">Manage and assign incoming leads.</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <div className="relative">
            <Search size={15} aria-hidden="true"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search" className="h-10 pl-8 pr-3 rounded-lg border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] w-44" />
          </div>
          <button type="button" onClick={refetch} aria-label="Refresh the list"
            className="h-10 w-10 flex items-center justify-center bg-[var(--paper)] border border-[var(--line)]
              text-[var(--ink-soft)] rounded-lg hover:border-[var(--ink-faint)] transition">
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total leads', value: stats.total, icon: Users, accent: false },
          { label: 'Unassigned', value: stats.unassigned, icon: Clock, accent: true },
          { label: 'Today', value: stats.today, icon: TrendingUp, accent: false },
          { label: 'Ready to join', value: stats.readyToJoin, icon: UserCheck, accent: false },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-5 border ${s.accent ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'bg-[var(--paper)] border-[var(--line)]'}`}>
            <div className="flex items-start justify-between">
              <div className={`text-[13px] font-medium ${s.accent ? 'text-white/70' : 'text-[var(--ink-faint)]'}`}>{s.label}</div>
              <s.icon size={17} className={s.accent ? 'text-white/50' : 'text-[var(--ink-faint)]'} />
            </div>
            <div className={`font-display text-[24px] font-semibold mt-3 leading-none ${s.accent ? 'text-white' : 'text-[var(--ink)]'}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-[var(--line-soft)] rounded-lg p-1 w-fit">
        {[
          { key: 'unassigned', label: `Unassigned (${stats.unassigned})` },
          { key: 'today', label: `Today (${stats.today})` },
          { key: 'all', label: `All (${stats.total})` },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key as any)}
            className={`px-4 h-11 sm:h-8 rounded-lg text-[13px] font-medium transition ${filter===f.key?'bg-[var(--paper)] text-[var(--ink)] shadow-[var(--shadow-raised)]':'text-[var(--ink-faint)] hover:text-[var(--ink)]'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] overflow-hidden shadow-[var(--shadow-raised)]">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <DataTable<Lead>
              caption="Leads awaiting assignment"
              state={state}
              onRetry={refetch}
              rows={filtered}
              rowKey={l => l.id}
              columns={leadColumns}
              emptyTitle="No leads in this view"
              emptyMessage="Change the filter above, or wait for new leads to arrive."
            />
          </div>
        )}
      </div>

      {/* Marketer activity — the reasons behind status moves */}
      {activities && activities.length > 0 && (
        <div className="mt-8">
          <SectionLabel>Marketer notes &amp; reasons</SectionLabel>
          <Card className="p-2">
            <div className="divide-y divide-[var(--line-soft)]">
              {activities.map((a) => (
                <div key={a.id} className="flex items-start gap-3 px-3 py-3">
                  <div className="w-9 h-9 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center flex-shrink-0 text-xs font-semibold">
                    {(a.author?.full_name || '?').charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[var(--ink)]">{a.lead?.full_name || 'Lead'}</span>
                      {a.subject && <Badge tone="neutral">{a.subject}</Badge>}
                    </div>
                    {a.description && <p className="text-sm text-[var(--ink-soft)] mt-1 leading-snug">{a.description}</p>}
                    <div className="text-[12px] text-[var(--ink-faint)] mt-1">
                      {a.author?.full_name || 'Unknown'} · {new Date(a.created_at).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })} {new Date(a.created_at).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

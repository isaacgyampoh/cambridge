'use client'
import { useState, useMemo, useEffect } from 'react'
import { useData } from '@/hooks/useData'
import { Spinner, EmptyState } from '@/components/ui'
import { ChevronLeft, Search } from 'lucide-react'

const fmtTime = (t: string) => {
  if (!t) return ''
  const d = new Date(t)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
const shortPhone = (p: string) => String(p || '').replace(/^233/, '0').replace(/#.*/, '')

export default function ConversationsPage() {
  const { data: convos, loading } = useData<any>({
    table: 'ai_conversations',
    select: '*, lead:lead_id(full_name, status, phone, assigned_to), marketer:marketer_id(full_name)',
    orderBy: 'created_at', orderAsc: false, limit: 1000,
  })

  // Every connected line — including staff who have not chatted yet, so a
  // newly onboarded number is visible straight away instead of missing.
  const [lines, setLines] = useState<any[]>([])
  useEffect(() => {
    const params = new URLSearchParams({
      table: 'profiles',
      select: 'id, full_name, role, phone, wasender_phone, wasender_status, wasender_api_key',
      limit: '200',
    })
    fetch(`/api/data?${params}`).then(r => r.json())
      .then(d => setLines((d.data || []).filter((p: any) => p.has_wasender_key || p.wasender_status || p.wasender_phone)))
      .catch(() => {})
  }, [])

  const [staffId, setStaffId] = useState<string | null>(null)
  const [phone, setPhone] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  /* staff -> threads -> messages */
  const byStaff = useMemo(() => {
    const out: Record<string, any> = {}
    // seed with every connected line so zero-chat staff still appear
    for (const p of lines) {
      out[p.id] = {
        id: p.id, name: p.full_name, role: p.role,
        line: p.wasender_phone || p.phone,
        connected: p.wasender_status === 'connected',
        threads: {}, total: 0, last: '',
      }
    }
    for (const c of convos || []) {
      // Older rows were written before the lead had an owner, so fall back to
      // whoever the lead belongs to now — otherwise assigned people show as
      // 'unassigned' forever.
      const sid = c.marketer_id || c.lead?.assigned_to || 'unassigned'
      if (!out[sid]) {
        out[sid] = {
          id: sid, name: c.marketer?.full_name || (sid === 'unassigned' ? 'Sent from the main line' : 'Staff'),
          role: null, line: null, connected: false,
          threads: {}, total: 0, last: c.created_at,
        }
      }
      const s = out[sid]
      const key = shortPhone(c.phone)
      if (!s.threads[key]) {
        s.threads[key] = {
          phone: key,
          leadPhone: c.lead?.phone || c.phone,
          name: c.lead?.full_name || null,
          status: c.lead?.status || null, leadId: c.lead_id,
          messages: [], last: c.created_at,
        }
      }
      s.threads[key].messages.push(c)
      s.total++
      if (!s.last || c.created_at > s.last) s.last = c.created_at
    }
    return out
  }, [convos, lines])

  const staffList = useMemo(() => {
    let list: any[] = Object.values(byStaff).map((s: any) => ({ ...s, threadCount: Object.keys(s.threads).length }))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name?.toLowerCase().includes(q) ||
        String(s.line || '').includes(q) ||
        Object.values(s.threads).some((t: any) => (t.name || '').toLowerCase().includes(q) || t.phone.includes(q)))
    }
    return list.sort((a, b) => {
      if (!!b.total !== !!a.total) return b.total - a.total
      return (b.last || '').localeCompare(a.last || '')
    })
  }, [byStaff, search, lines])

  const staff = staffId ? byStaff[staffId] : null
  const threads: any[] = staff ? Object.values(staff.threads).sort((a: any, b: any) => (b.last || '').localeCompare(a.last || '')) : []
  const thread = staff && phone ? staff.threads[phone] : null

  const turns = useMemo(() => {
    if (!thread) return []
    const rows: any[] = []
    for (const m of [...thread.messages].reverse()) {
      if (m.incoming_text) rows.push({ who: 'lead', text: m.incoming_text, at: m.created_at })
      if (m.reply_text) rows.push({ who: m.answered_by === 'human' ? 'staff' : 'ai', text: m.reply_text, at: m.created_at })
    }
    return rows
  }, [thread])

  if (loading) return <Spinner />

  const Avatar = ({ name, on }: { name: string; on?: boolean }) => (
    <div className="relative flex-shrink-0">
      <div className="w-9 h-9 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center font-semibold text-[14px]">
        {(name || '?').charAt(0).toUpperCase()}
      </div>
      {on && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[var(--ok)] border-2 border-[var(--paper)]" />}
    </div>
  )

  /* ── Panes ── */
  const StaffPane = (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-[var(--line)]">
        <h2 className="font-display text-[17px] font-semibold text-[var(--ink)] mb-3">Staff lines</h2>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-[var(--line)] bg-[var(--canvas)] text-[14px] focus:outline-none focus:border-[var(--accent)]" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {staffList.length === 0 ? (
          <p className="p-4 text-[13.5px] text-[var(--ink-soft)]">No WhatsApp lines connected yet.</p>
        ) : staffList.map((s: any) => (
          <button key={s.id} onClick={() => { setStaffId(s.id); setPhone(null) }}
            className={`w-full text-left px-4 py-3 flex items-center gap-3 border-l-2 transition ${
              staffId === s.id
                ? 'bg-[var(--accent-soft)] border-l-[var(--accent)]'
                : 'border-l-transparent hover:bg-[var(--line-soft)]'}`}>
            <Avatar name={s.name} on={s.connected} />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[var(--ink)] text-[14.5px] truncate">{s.name}</div>
              <div className="text-[12px] text-[var(--ink-faint)] truncate">
                {s.line ? shortPhone(s.line) : (s.id === 'unassigned' ? 'Central number' : 'No line connected')}
                {s.threadCount ? ` · ${s.threadCount} chatting` : ' · no chats yet'}
              </div>
            </div>
            {s.total > 0 && <span className="text-[11px] text-[var(--ink-faint)] flex-shrink-0">{fmtTime(s.last)}</span>}
          </button>
        ))}
      </div>
    </div>
  )

  const ThreadPane = staff && (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-[var(--line)]">
        <div className="flex items-center gap-2">
          <button onClick={() => setStaffId(null)} className="lg:hidden text-[var(--ink-soft)]"><ChevronLeft size={18} /></button>
          <div className="min-w-0">
            <h2 className="font-display text-[16px] font-semibold text-[var(--ink)] truncate">{staff.name}</h2>
            <p className="text-[12px] text-[var(--ink-soft)] truncate">
              {staff.line ? `Sending from ${shortPhone(staff.line)}` : 'No number linked'}
              {staff.connected ? ' · connected' : ''}
            </p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <p className="p-4 text-[13.5px] text-[var(--ink-soft)]">No conversations on this line yet.</p>
        ) : threads.map((t: any) => {
          const lastMsg = t.messages[0]
          const preview = lastMsg?.incoming_text || lastMsg?.reply_text || ''
          return (
            <button key={t.phone} onClick={() => setPhone(t.phone)}
              className={`w-full text-left px-4 py-3 border-l-2 transition ${
                phone === t.phone ? 'bg-[var(--accent-soft)] border-l-[var(--accent)]' : 'border-l-transparent hover:bg-[var(--line-soft)]'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-[var(--ink)] text-[14.5px] truncate">{t.name || shortPhone(t.phone)}</span>
                <span className="text-[11px] text-[var(--ink-faint)] flex-shrink-0">{fmtTime(t.last)}</span>
              </div>
              <div className="text-[12.5px] text-[var(--ink-soft)] mt-0.5 font-medium">{shortPhone(t.leadPhone || t.phone)}</div>
              {preview && <div className="text-[13px] text-[var(--ink-soft)] mt-1 line-clamp-1">{preview}</div>}
            </button>
          )
        })}
      </div>
    </div>
  )

  const TranscriptPane = thread && (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-[var(--line)] flex items-center gap-2">
        <button onClick={() => setPhone(null)} className="lg:hidden text-[var(--ink-soft)]"><ChevronLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[16px] font-semibold text-[var(--ink)] truncate">{thread.name || shortPhone(thread.phone)}</h2>
          <p className="text-[12.5px] text-[var(--ink-soft)] truncate">
            <a href={`tel:${thread.leadPhone || thread.phone}`} className="font-medium text-[var(--accent)]">
              {shortPhone(thread.leadPhone || thread.phone)}
            </a>
            {thread.status ? ` · ${String(thread.status).replace(/_/g, ' ')}` : ''}
          </p>
        </div>
        {thread.leadId && (
          <a href={`/marketer/leads/${thread.leadId}`}
            className="text-[12.5px] font-semibold text-[var(--accent)] flex-shrink-0">Open lead</a>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ background: 'var(--canvas)' }}>
        {turns.map((t, i) => {
          const mine = t.who !== 'lead'
          return (
            <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%]">
                <div className={`text-[10px] font-semibold uppercase tracking-wide mb-1 ${mine ? 'text-right' : ''} ${
                  t.who === 'ai' ? 'text-[var(--accent)]' : t.who === 'staff' ? 'text-[var(--ok)]' : 'text-[var(--ink-faint)]'}`}>
                  {t.who === 'lead' ? (thread.name || 'Lead') : t.who === 'staff' ? `${staff.name} (typed)` : 'Assistant'}
                </div>
                <div className={`rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap ${
                  t.who === 'lead' ? 'bg-[var(--paper)] border border-[var(--line)] text-[var(--ink)] rounded-tl-sm'
                    : t.who === 'staff' ? 'bg-[var(--ok-soft)] text-[var(--ink)] rounded-tr-sm'
                      : 'bg-[var(--accent)] text-white rounded-tr-sm'}`}>{t.text}</div>
                <div className={`text-[10.5px] text-[var(--ink-faint)] mt-1 ${mine ? 'text-right' : ''}`}>{fmtTime(t.at)}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  /* ── Layout: three panes side by side on desktop, drill-down on mobile ── */
  return (
    <div className="fade-in w-full">
      <div className="mb-4 lg:mb-5">
        <h1 className="font-display text-[22px] sm:text-[26px] font-semibold text-[var(--ink)]">Conversations</h1>
        <p className="text-[13.5px] sm:text-[14px] text-[var(--ink-soft)] mt-1">
          Every WhatsApp chat, grouped by the staff line it goes through.
        </p>
      </div>

      {/* Desktop: master / detail / transcript */}
      <div className="hidden lg:grid grid-cols-[280px_320px_1fr] gap-0 bg-[var(--paper)] border border-[var(--line)] rounded-2xl overflow-hidden"
        style={{ height: 'calc(100dvh - 210px)', minHeight: 460 }}>
        <div className="border-r border-[var(--line)] min-w-0">{StaffPane}</div>
        <div className="border-r border-[var(--line)] min-w-0">
          {staff ? ThreadPane : (
            <div className="h-full flex items-center justify-center p-6 text-center">
              <p className="text-[13.5px] text-[var(--ink-faint)]">Select a staff line</p>
            </div>
          )}
        </div>
        <div className="min-w-0">
          {thread ? TranscriptPane : (
            <div className="h-full flex items-center justify-center p-6 text-center" style={{ background: 'var(--canvas)' }}>
              <p className="text-[13.5px] text-[var(--ink-faint)]">
                {staff ? 'Select a conversation' : 'Choose a line to see its conversations'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: one pane at a time */}
      <div className="lg:hidden bg-[var(--paper)] border border-[var(--line)] rounded-2xl overflow-hidden"
        style={{ height: 'calc(100dvh - 200px)', minHeight: 420 }}>
        {thread ? TranscriptPane : staff ? ThreadPane : StaffPane}
      </div>
    </div>
  )
}

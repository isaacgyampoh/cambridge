'use client'
import { useState, useMemo } from 'react'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Badge, Spinner, EmptyState, inputClass } from '@/components/ui'
import { ChevronLeft, Search } from 'lucide-react'

const fmtTime = (t: string) =>
  new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const shortPhone = (p: string) => String(p || '').replace(/^233/, '0').replace(/#.*/, '')

export default function ConversationsPage() {
  const { data: convos, loading } = useData<any>({
    table: 'ai_conversations',
    select: '*, lead:lead_id(full_name, status), marketer:marketer_id(full_name, wasender_phone, phone)',
    orderBy: 'created_at', orderAsc: false, limit: 1000,
  })
  const [staffId, setStaffId] = useState<string | null>(null)
  const [phone, setPhone] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  /* Group: staff line -> lead thread -> messages */
  const byStaff = useMemo(() => {
    const out: Record<string, any> = {}
    for (const c of convos || []) {
      const sid = c.marketer_id || 'unassigned'
      if (!out[sid]) {
        out[sid] = {
          id: sid,
          name: c.marketer?.full_name || 'No staff line',
          line: c.marketer?.wasender_phone || c.marketer?.phone || null,
          threads: {} as Record<string, any>,
          total: 0,
          last: c.created_at,
        }
      }
      const s = out[sid]
      const key = shortPhone(c.phone)
      if (!s.threads[key]) {
        s.threads[key] = {
          phone: key, rawPhone: c.phone,
          name: c.lead?.full_name || null,
          status: c.lead?.status || null,
          leadId: c.lead_id,
          messages: [], last: c.created_at,
        }
      }
      s.threads[key].messages.push(c)
      s.total++
      if (c.created_at > s.last) s.last = c.created_at
    }
    return out
  }, [convos])

  const staffList = useMemo(() => {
    let list: any[] = Object.values(byStaff).map((s: any) => ({
      ...s, threadCount: Object.keys(s.threads).length,
    }))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        Object.values(s.threads).some((t: any) =>
          (t.name || '').toLowerCase().includes(q) || t.phone.includes(q)))
    }
    return list.sort((a, b) => (b.last || '').localeCompare(a.last || ''))
  }, [byStaff, search])

  const staff = staffId ? byStaff[staffId] : null
  const threads: any[] = staff
    ? Object.values(staff.threads).sort((a: any, b: any) => (b.last || '').localeCompare(a.last || ''))
    : []
  const thread = staff && phone ? staff.threads[phone] : null

  /* Build a readable transcript: oldest first, each turn labelled */
  const turns = useMemo(() => {
    if (!thread) return []
    const rows: any[] = []
    for (const m of [...thread.messages].reverse()) {
      if (m.incoming_text) rows.push({ who: 'lead', text: m.incoming_text, at: m.created_at })
      if (m.reply_text) {
        rows.push({
          who: m.answered_by === 'human' ? 'staff' : 'ai',
          text: m.reply_text, at: m.created_at,
        })
      }
    }
    return rows
  }, [thread])

  if (loading) return <Spinner />

  /* ── Thread view ── */
  if (thread) {
    return (
      <div className="fade-in w-full max-w-3xl">
        <button onClick={() => setPhone(null)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink-soft)] mb-4">
          <ChevronLeft size={16} /> {staff.name}
        </button>

        <div className="mb-5">
          <h1 className="font-display text-[22px] font-semibold text-[var(--ink)]">
            {thread.name || shortPhone(thread.phone)}
          </h1>
          <p className="text-[13px] text-[var(--ink-soft)] mt-1">
            {shortPhone(thread.phone)} · through {staff.name}{staff.line ? ` (${shortPhone(staff.line)})` : ''}
            {thread.status ? ` · ${String(thread.status).replace(/_/g, ' ')}` : ''}
          </p>
          {thread.leadId && (
            <a href={`/marketer/leads/${thread.leadId}`}
              className="inline-block mt-2 text-[13px] font-semibold text-[var(--accent)]">Open lead</a>
          )}
        </div>

        <Card className="p-4 sm:p-5">
          <div className="space-y-3">
            {turns.map((t, i) => {
              const mine = t.who !== 'lead'
              return (
                <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[85%] sm:max-w-[75%]">
                    <div className={`text-[10.5px] font-semibold uppercase tracking-wide mb-1 ${mine ? 'text-right' : ''} ${
                      t.who === 'ai' ? 'text-[var(--accent)]' : t.who === 'staff' ? 'text-[var(--ok)]' : 'text-[var(--ink-faint)]'
                    }`}>
                      {t.who === 'lead' ? (thread.name || 'Lead') : t.who === 'staff' ? `${staff.name} (typed)` : 'Assistant'}
                    </div>
                    <div className={`rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap ${
                      t.who === 'lead'
                        ? 'bg-[var(--line-soft)] text-[var(--ink)] rounded-tl-sm'
                        : t.who === 'staff'
                          ? 'bg-[var(--ok-soft)] text-[var(--ink)] rounded-tr-sm'
                          : 'bg-[var(--accent)] text-white rounded-tr-sm'
                    }`}>{t.text}</div>
                    <div className={`text-[11px] text-[var(--ink-faint)] mt-1 ${mine ? 'text-right' : ''}`}>{fmtTime(t.at)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    )
  }

  /* ── Lead list for one staff line ── */
  if (staff) {
    return (
      <div className="fade-in w-full max-w-3xl">
        <button onClick={() => setStaffId(null)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink-soft)] mb-4">
          <ChevronLeft size={16} /> All lines
        </button>

        <div className="mb-5">
          <h1 className="font-display text-[22px] font-semibold text-[var(--ink)]">{staff.name}</h1>
          <p className="text-[13px] text-[var(--ink-soft)] mt-1">
            {staff.line ? `Sending from ${shortPhone(staff.line)} · ` : ''}
            {threads.length} {threads.length === 1 ? 'person' : 'people'} chatting through this line
          </p>
        </div>

        <Card className="overflow-hidden">
          <div className="divide-y divide-[var(--line-soft)]">
            {threads.map((t: any) => {
              const lastMsg = t.messages[0]
              const preview = lastMsg?.incoming_text || lastMsg?.reply_text || ''
              return (
                <button key={t.phone} onClick={() => setPhone(t.phone)}
                  className="w-full text-left p-4 hover:bg-[var(--line-soft)] transition">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--ink)] text-[15px] truncate">
                        {t.name || shortPhone(t.phone)}
                      </div>
                      <div className="text-[12.5px] text-[var(--ink-faint)] mt-0.5">{shortPhone(t.phone)}</div>
                      {preview && (
                        <div className="text-[13px] text-[var(--ink-soft)] mt-1.5 line-clamp-1">{preview}</div>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {t.status && <Badge tone="neutral">{String(t.status).replace(/_/g, ' ')}</Badge>}
                      <div className="text-[11.5px] text-[var(--ink-faint)] mt-1.5">{fmtTime(t.last)}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </Card>
      </div>
    )
  }

  /* ── Staff lines ── */
  return (
    <div className="fade-in w-full max-w-3xl">
      <PageHeader eyebrow="Messaging" title="Conversations"
        description="Every WhatsApp chat, grouped by the staff line it went through. Tap a line to see who they are talking to." />

      <div className="relative mb-5 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search staff, lead or number" className={inputClass + ' pl-9'} />
      </div>

      {staffList.length === 0 ? (
        <EmptyState title="No conversations yet"
          description="Once leads start replying on WhatsApp, their chats appear here grouped by staff line." />
      ) : (
        <div className="space-y-2">
          {staffList.map((s: any) => (
            <button key={s.id} onClick={() => setStaffId(s.id)}
              className="w-full text-left bg-[var(--paper)] border border-[var(--line)] rounded-xl p-4 hover:border-[var(--accent)]/40 transition">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center font-semibold text-[15px] flex-shrink-0">
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--ink)] text-[15px] truncate">{s.name}</div>
                    <div className="text-[12.5px] text-[var(--ink-soft)] mt-0.5">
                      {s.line ? <span className="font-medium">{shortPhone(s.line)}</span> : 'No number linked'}
                    </div>
                    <div className="text-[12px] text-[var(--ink-faint)] mt-0.5">
                      {s.threadCount} {s.threadCount === 1 ? 'person' : 'people'} · {s.total} messages
                    </div>
                  </div>
                </div>
                <div className="text-[11.5px] text-[var(--ink-faint)] flex-shrink-0">{fmtTime(s.last)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

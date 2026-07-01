'use client'
import { useState, useEffect, useRef } from 'react'
import { PageHeader, Card, Spinner } from '@/components/ui'
import { ROLE_LABELS } from '@/lib/utils'

export default function Messages() {
  const [staff, setStaff] = useState<any[]>([])
  const [active, setActive] = useState<any>(null)
  const [thread, setThread] = useState<any[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<string>('')
  const [search, setSearch] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  async function loadList() {
    const d = await fetch('/api/messages').then(r => r.json())
    setStaff(d.staff || [])
    setLoading(false)
  }
  useEffect(() => { loadList(); fetch('/api/auth/me').then(r => r.json()).then(d => setMe(d.userId || '')) }, [])

  async function openThread(s: any) {
    setActive(s)
    const d = await fetch(`/api/messages?with=${s.id}`).then(r => r.json())
    setThread(d.messages || [])
    setStaff(prev => prev.map(x => x.id === s.id ? { ...x, unread: 0 } : x))
    setTimeout(() => scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight), 50)
  }

  async function send() {
    const body = input.trim()
    if (!body || !active) return
    setInput('')
    const optimistic = { id: 'tmp' + Date.now(), sender_id: me, recipient_id: active.id, body, created_at: new Date().toISOString() }
    setThread(t => [...t, optimistic])
    setTimeout(() => scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight), 50)
    await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: active.id, body }) })
  }

  // Poll the open thread for new messages
  useEffect(() => {
    if (!active) return
    const t = setInterval(async () => {
      const d = await fetch(`/api/messages?with=${active.id}`).then(r => r.json())
      setThread(d.messages || [])
    }, 5000)
    return () => clearInterval(t)
  }, [active])

  const filtered = staff.filter(s => s.full_name?.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="fade-in w-full">
      <PageHeader eyebrow="Team" title="Messages" description="Private in-house chat with your colleagues. Nothing leaves the system." />

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 h-[calc(100vh-220px)]">
        {/* Staff list */}
        <Card className="p-0 overflow-hidden flex flex-col">
          <div className="p-3 border-b border-[var(--line)]">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search colleagues…"
              className="w-full h-10 px-3 rounded-lg border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? <Spinner /> : filtered.map(s => (
              <button key={s.id} onClick={() => openThread(s)}
                className={`w-full text-left px-4 py-3 border-b border-[var(--line-soft)] hover:bg-[var(--canvas)] transition ${active?.id === s.id ? 'bg-[var(--accent-soft)]' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[var(--ink)] truncate">{s.full_name}</span>
                  {s.unread > 0 && <span className="text-[11px] font-semibold text-white bg-[var(--accent)] rounded-full px-2 py-0.5 flex-shrink-0">{s.unread}</span>}
                </div>
                <span className="text-[12px] text-[var(--ink-faint)]">{ROLE_LABELS?.[s.role] || s.role}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* Conversation */}
        <Card className="p-0 overflow-hidden flex flex-col">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-[var(--ink-faint)] text-sm">Select a colleague to start chatting</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-[var(--line)]">
                <div className="font-semibold text-[var(--ink)]">{active.full_name}</div>
                <div className="text-[12px] text-[var(--ink-faint)]">{ROLE_LABELS?.[active.role] || active.role}</div>
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
                {thread.length === 0 && <div className="text-center text-sm text-[var(--ink-faint)] mt-8">No messages yet. Say hello.</div>}
                {thread.map(m => {
                  const mine = m.sender_id === me
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed whitespace-pre-wrap ${mine ? 'bg-[var(--accent)] text-white' : 'bg-[var(--canvas)] text-[var(--ink)]'}`}>
                        {m.body}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="border-t border-[var(--line)] p-3 flex items-end gap-2">
                <textarea value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  rows={1} placeholder="Type a message…"
                  className="flex-1 resize-none max-h-32 px-3.5 py-2.5 rounded-xl border border-[var(--line)] text-[14px] focus:outline-none focus:border-[var(--accent)]" />
                <button onClick={send} disabled={!input.trim()}
                  className="h-11 px-5 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-40">Send</button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}

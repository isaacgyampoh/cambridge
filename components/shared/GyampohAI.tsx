'use client'
import { useState, useRef, useEffect } from 'react'

type Msg = { role: 'user' | 'assistant'; content: string }

export default function GyampohAI() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [alerts, setAlerts] = useState<string[]>([])
  const [listening, setListening] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<any>(null)

  // Voice input via the browser's Web Speech API (no extra service needed)
  function toggleVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Voice input is not supported on this browser. Try Chrome.'); return }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return }
    const rec = new SR()
    rec.lang = 'en-GH'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results).map((r: any) => r[0].transcript).join('')
      setInput(transcript)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recognitionRef.current = rec
    rec.start()
    setListening(true)
  }

  useEffect(() => {
    if (open && alerts.length === 0) {
      fetch('/api/assistant/briefing').then(r => r.json()).then(d => {
        if (d.alerts?.length) setAlerts(d.alerts)
      }).catch(() => {})
    }
  }, [open])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, busy])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const d = await res.json()
      if (d.reply) setMessages([...next, { role: 'assistant', content: d.reply }])
      else setMessages([...next, { role: 'assistant', content: d.error || 'Sorry, I could not respond just now.' }])
    } catch {
      setMessages([...next, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
    } finally {
      setBusy(false)
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 h-12 px-5 rounded-full bg-[var(--accent)] text-white text-sm font-semibold shadow-lg hover:brightness-110 transition-all"
          style={{ boxShadow: '0 4px 20px rgba(26,122,133,0.35)' }}>
          Gyampoh AI
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-[calc(100vw-2.5rem)] sm:w-[400px] h-[600px] max-h-[calc(100vh-2.5rem)] bg-[var(--paper)] border border-[var(--line)] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)] bg-[var(--canvas)]">
            <div>
              <div className="font-display font-semibold text-[var(--ink)] text-[15px]">Gyampoh AI</div>
              <div className="text-[12px] text-[var(--ink-faint)]">Your CCE assistant</div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button onClick={() => setMessages([])} className="text-[12px] text-[var(--ink-faint)] hover:text-[var(--ink-soft)] px-2 py-1 rounded-lg hover:bg-[var(--line-soft)]">Clear</button>
              )}
              <button onClick={() => setOpen(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)] px-2 py-1 rounded-lg hover:bg-[var(--line-soft)] text-lg leading-none">×</button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center mt-8">
                <div className="font-display text-lg font-semibold text-[var(--ink)] mb-1">Hello, I'm Gyampoh AI</div>
                <p className="text-sm text-[var(--ink-soft)] max-w-[260px] mx-auto leading-relaxed">Ask me about our data, get advice, or help writing. I can look things up in the system for you.</p>

                {alerts.length > 0 && (
                  <div className="mt-5 text-left bg-[var(--warn-soft)] rounded-xl p-3.5">
                    <div className="text-[12px] font-semibold text-[var(--warn)] mb-1.5">Things needing attention</div>
                    <ul className="space-y-1">
                      {alerts.map((a, i) => (
                        <li key={i} className="text-[13px] text-[var(--ink-soft)] leading-snug">{a}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-5 space-y-2">
                  {['How many leads have I converted?', 'Help me convince a lead who is hesitant to join', 'What are the PMP course fees?'].map(s => (
                    <button key={s} onClick={() => setInput(s)}
                      className="block w-full text-left text-[13px] text-[var(--ink-soft)] bg-[var(--canvas)] hover:bg-[var(--line-soft)] rounded-xl px-3 py-2.5 transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap
                  ${m.role === 'user'
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--canvas)] text-[var(--ink)]'}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-[var(--canvas)] rounded-2xl px-4 py-3">
                  <span className="inline-block w-2 h-2 bg-[var(--ink-faint)] rounded-full animate-pulse" />
                  <span className="inline-block w-2 h-2 bg-[var(--ink-faint)] rounded-full animate-pulse mx-1" style={{ animationDelay: '0.2s' }} />
                  <span className="inline-block w-2 h-2 bg-[var(--ink-faint)] rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-[var(--line)] p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                placeholder={listening ? 'Listening… speak now' : 'Ask Gyampoh AI anything…'}
                className="flex-1 resize-none max-h-32 px-3.5 py-2.5 rounded-xl border border-[var(--line)] bg-white text-[14px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]" />
              <button onClick={toggleVoice} title="Speak"
                className={`h-11 px-3 rounded-xl text-sm font-semibold flex-shrink-0 transition ${listening ? 'bg-[var(--danger)] text-white' : 'bg-[var(--line-soft)] text-[var(--ink-soft)] hover:bg-[var(--line)]'}`}>
                {listening ? 'Stop' : 'Speak'}
              </button>
              <button onClick={send} disabled={busy || !input.trim()}
                className="h-11 px-4 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-40 hover:brightness-110 transition flex-shrink-0">
                Send
              </button>
            </div>
            <p className="text-[11px] text-[var(--ink-faint)] mt-2 text-center">Gyampoh AI can make mistakes. Verify important details.</p>
          </div>
        </div>
      )}
    </>
  )
}

'use client'
import { uploadFile as uploadToStorage } from '@/lib/upload'
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
  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const mediaRec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunks.current = []
      rec.ondataavailable = e => chunks.current.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks.current, { type: 'audio/webm' })
        await uploadVoice(blob)
      }
      mediaRec.current = rec
      rec.start()
      setRecording(true)
    } catch {
      alert('Could not access the microphone. Please allow mic permission.')
    }
  }

  function stopRecording() {
    mediaRec.current?.stop()
    setRecording(false)
  }

  async function uploadVoice(blob: Blob) {
    if (!active) return
    setUploading(true)
    try {
      const voiceFile = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || 'audio/webm' })
      const data = await uploadToStorage(voiceFile, 'voice-notes')
      if (data.url) {
        const optimistic = { id: 'tmp' + Date.now(), sender_id: me, recipient_id: active.id, audio_url: data.url, created_at: new Date().toISOString() }
        setThread(t => [...t, optimistic])
        setTimeout(() => scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight), 50)
        await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: active.id, audio_url: data.url }) })
      }
    } catch {
      alert('Could not send the voice note. Try again.')
    } finally {
      setUploading(false)
    }
  }

  async function uploadFile(file: File) {
    if (!active) return
    const isImage = file.type.startsWith('image/')
    setUploading(true)
    try {
      const data = await uploadToStorage(file, 'messages')
      if (data.url) {
        const meta = { file_url: data.url, file_name: file.name, file_type: isImage ? 'image' : 'document', file_size: file.size }
        const optimistic = { id: 'tmp' + Date.now(), sender_id: me, recipient_id: active.id, ...meta, created_at: new Date().toISOString() }
        setThread(t => [...t, optimistic])
        setTimeout(() => scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight), 50)
        await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: active.id, ...meta }) })
      } else { alert('Upload failed. Try again.') }
    } catch {
      alert('Could not send the file. Try again.')
    } finally {
      setUploading(false)
    }
  }

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
      <div className="hidden sm:block">
        <PageHeader eyebrow="Team" title="Messages" description="Private in-house chat with your colleagues. Nothing leaves the system." />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 h-[calc(100vh-160px)] sm:h-[calc(100vh-220px)]">
        {/* Staff list — full screen on mobile when no chat open; hidden on mobile when a chat is open */}
        <Card className={`p-0 overflow-hidden flex flex-col ${active ? 'hidden lg:flex' : 'flex'}`}>
          <div className="p-3 border-b border-[var(--line)]">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search colleagues…"
              className="w-full h-10 px-3 rounded-lg border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? <Spinner /> : filtered.map(s => (
              <button key={s.id} onClick={() => openThread(s)}
                className={`w-full text-left px-4 py-3.5 border-b border-[var(--line-soft)] hover:bg-[var(--canvas)] transition ${active?.id === s.id ? 'bg-[var(--accent-soft)]' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-medium text-[var(--ink)] truncate">{s.full_name}</span>
                  {s.unread > 0 && <span className="text-[11px] font-semibold text-white bg-[var(--accent)] rounded-full px-2 py-0.5 flex-shrink-0">{s.unread}</span>}
                </div>
                <span className="text-[13px] text-[var(--ink-faint)]">{ROLE_LABELS?.[s.role] || s.role}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* Conversation — fixed full-screen overlay on mobile (uses dvh so the
            input stays above the keyboard); normal panel on desktop */}
        <Card className={`p-0 overflow-hidden flex-col
          ${active ? 'flex' : 'hidden lg:flex'}
          ${active ? 'fixed inset-0 z-50 rounded-none lg:static lg:z-auto lg:rounded-2xl' : ''}`}>
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-[var(--ink-faint)] text-sm">Select a colleague to start chatting</div>
          ) : (
            <div className="flex flex-col h-[100dvh] lg:h-full">
              <div className="px-4 py-3 border-b border-[var(--line)] flex items-center gap-3 flex-shrink-0">
                {/* Back button — mobile only */}
                <button onClick={() => setActive(null)} className="lg:hidden text-[var(--accent)] text-sm font-medium">Back</button>
                <div>
                  <div className="font-semibold text-[var(--ink)]">{active.full_name}</div>
                  <div className="text-[12px] text-[var(--ink-faint)]">{ROLE_LABELS?.[active.role] || active.role}</div>
                </div>
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
                {thread.length === 0 && <div className="text-center text-sm text-[var(--ink-faint)] mt-8">No messages yet. Say hello.</div>}
                {thread.map(m => {
                  const mine = m.sender_id === me
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      {m.audio_url ? (
                        <div className={`max-w-[80%] rounded-2xl px-2 py-2 ${mine ? 'bg-[var(--accent)]' : 'bg-[var(--canvas)]'}`}>
                          <audio controls src={m.audio_url} className="h-9" style={{ maxWidth: '220px' }} />
                        </div>
                      ) : m.file_url ? (
                        m.file_type === 'image' ? (
                          <a href={m.file_url} target="_blank" rel="noopener noreferrer" className="max-w-[70%] block">
                            <img src={m.file_url} alt={m.file_name || 'image'} className="rounded-2xl max-h-64 object-cover" />
                          </a>
                        ) : (
                          <a href={m.file_url} target="_blank" rel="noopener noreferrer"
                            className={`max-w-[80%] flex items-center gap-3 rounded-2xl px-3.5 py-3 ${mine ? 'bg-[var(--accent)] text-white' : 'bg-[var(--canvas)] text-[var(--ink)]'}`}>
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-[11px] font-bold ${mine ? 'bg-white/20' : 'bg-[var(--accent-soft)] text-[var(--accent)]'}`}>
                              {(m.file_name?.split('.').pop() || 'FILE').toUpperCase().slice(0, 4)}
                            </div>
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium truncate">{m.file_name || 'Document'}</div>
                              <div className={`text-[11px] ${mine ? 'text-white/70' : 'text-[var(--ink-faint)]'}`}>{m.file_size ? `${Math.round(m.file_size / 1024)} KB · ` : ''}Tap to open</div>
                            </div>
                          </a>
                        )
                      ) : (
                        <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed whitespace-pre-wrap ${mine ? 'bg-[var(--accent)] text-white' : 'bg-[var(--canvas)] text-[var(--ink)]'}`}>
                          {m.body}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="border-t border-[var(--line)] p-3 flex items-end gap-2 flex-shrink-0 bg-[var(--paper)]">
                <label className={`h-11 w-11 flex items-center justify-center rounded-xl bg-[var(--line-soft)] text-[var(--ink-soft)] cursor-pointer flex-shrink-0 hover:bg-[var(--line)] transition ${uploading ? 'opacity-50 pointer-events-none' : ''}`} title="Attach a file">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                  <input type="file" className="hidden" disabled={uploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
                </label>
                <textarea value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  rows={1} placeholder={recording ? 'Recording… tap Stop to send' : 'Type a message…'}
                  className="flex-1 resize-none max-h-32 px-3.5 py-2.5 rounded-xl border border-[var(--line)] text-[14px] focus:outline-none focus:border-[var(--accent)]" />
                {input.trim() ? (
                  <button onClick={send}
                    className="h-11 px-5 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold flex-shrink-0">Send</button>
                ) : (
                  <button onClick={recording ? stopRecording : startRecording} disabled={uploading}
                    className={`h-11 px-4 rounded-xl text-sm font-semibold flex-shrink-0 ${recording ? 'bg-[var(--danger)] text-white' : 'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
                    {uploading ? 'Sending…' : recording ? 'Stop' : 'Record'}
                  </button>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

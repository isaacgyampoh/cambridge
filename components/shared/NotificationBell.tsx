'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Notif {
  id: string
  type: string
  title: string
  body?: string
  link?: string
  is_read: boolean
  created_at: string
}

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function NotificationBell({ userId }: { userId: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notif[]>([])
  const ref = useRef<HTMLDivElement>(null)

  /**
   * Fetch without touching state, so the caller decides when to apply it.
   *
   * This bell sits in the header of every screen, so a setState called
   * synchronously inside its mount effect cascades a render of the whole shell
   * on every navigation. Applying the result after the await avoids that, and
   * the alive flag stops a slow response writing to an unmounted component.
   */
  const load = useCallback(async (): Promise<Notif[] | null> => {
    if (!userId) return null
    const params = new URLSearchParams({
      table: 'notifications', select: '*',
      filters: JSON.stringify([{ col: 'user_id', op: 'eq', val: userId }]),
      orderBy: 'created_at', orderAsc: 'false', limit: '30',
    })
    try {
      const d = await fetch(`/api/data?${params}`).then(r => (r.ok ? r.json() : null))
      return (d?.data || []) as Notif[]
    } catch {
      return null
    }
  }, [userId])

  useEffect(() => {
    if (!userId) return
    let alive = true

    const refresh = () => { void load().then(rows => { if (alive && rows) setItems(rows) }) }

    refresh()
    const timer = setInterval(refresh, 30000)
    return () => { alive = false; clearInterval(timer) }
  }, [userId, load])

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const unread = items.filter(i => !i.is_read).length

  async function markRead(id: string) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, is_read: true } : i))
    try {
      await fetch('/api/data', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: 'notifications', data: { is_read: true }, filters: [{ col: 'id', val: id }] }),
      })
    } catch {}
  }

  async function markAllRead() {
    const ids = items.filter(i => !i.is_read).map(i => i.id)
    setItems(prev => prev.map(i => ({ ...i, is_read: true })))
    for (const id of ids) {
      try {
        await fetch('/api/data', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ table: 'notifications', data: { is_read: true }, filters: [{ col: 'id', val: id }] }),
        })
      } catch {}
    }
  }

  function openItem(n: Notif) {
    if (!n.is_read) markRead(n.id)
    if (n.link) { setOpen(false); router.push(n.link) }
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="menu" aria-expanded={open}
        className="relative w-10 h-10 grid place-items-center text-[var(--ink-faint)]
          hover:text-[var(--ink)] hover:bg-[var(--line-soft)] rounded-xl transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[14px] h-3.5 bg-red-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center px-0.5">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-[var(--shadow-overlay)] border border-[var(--line)] z-[200] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)]">
            <span className="text-sm font-semibold text-[var(--ink)]">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs font-medium text-[var(--accent)] hover:underline flex items-center gap-1">
                <Check size={12} /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-12 text-center">
                <Bell size={22} className="mx-auto text-[var(--ink-faint)] opacity-40 mb-2" />
                <p className="text-sm text-[var(--ink-faint)]">No notifications</p>
              </div>
            ) : items.map(n => (
              <button key={n.id} onClick={() => openItem(n)}
                className={`w-full text-left px-4 py-3 border-b border-[var(--line-soft)] last:border-0 transition hover:bg-[var(--line-soft)] ${!n.is_read ? 'bg-[var(--accent-soft)]/40' : ''}`}>
                <div className="flex items-start gap-2.5">
                  {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] flex-shrink-0 mt-1.5" />}
                  <div className={`min-w-0 flex-1 ${n.is_read ? 'pl-4' : ''}`}>
                    <div className="text-sm font-medium text-[var(--ink)]">{n.title}</div>
                    {n.body && <div className="text-xs text-[var(--ink-soft)] mt-0.5 line-clamp-2">{n.body}</div>}
                    <div className="text-[11px] text-[var(--ink-faint)] mt-1">{timeAgo(n.created_at)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* The dropdown is a preview of the most recent thirty. Everything
              older, and any way to filter, lives on the full page. */}
          <Link href="/notifications" onClick={() => setOpen(false)}
            className="block px-4 py-3 border-t border-[var(--line)] text-center text-[13px]
              font-semibold text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset
              focus-visible:ring-[var(--accent)]">
            See all notifications
          </Link>
        </div>
      )}
    </div>
  )
}

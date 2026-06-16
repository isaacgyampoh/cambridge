'use client'
import { useState, useEffect } from 'react'
import { Video, Calendar, Megaphone, Link2, Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

const TYPE_ICON: Record<string, any> = { zoom: Video, info_session: Calendar, announcement: Megaphone, general: Link2 }

/**
 * Shows the active shared links posted by the super admin. Appears on every
 * worker's "My Links" view. Temporary links drop off automatically when they
 * expire or are removed.
 */
export default function SharedLinks() {
  const [links, setLinks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/links').then(r => r.ok ? r.json() : { links: [] })
      .then(d => { setLinks(d.links || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading || links.length === 0) return null

  return (
    <div className="mb-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-3">Shared with you</p>
      <div className="space-y-2">
        {links.map((l: any) => {
          const Icon = TYPE_ICON[l.link_type] || Link2
          return (
            <div key={l.id} className="bg-[var(--paper)] border border-[var(--line)] rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center flex-shrink-0"><Icon size={16} /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[var(--ink)] truncate">{l.title}</div>
                  {l.description && <div className="text-xs text-[var(--ink-faint)] truncate">{l.description}</div>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-[var(--line-soft)] border border-[var(--line)] rounded-lg px-3 py-2 text-xs text-[var(--ink-soft)] font-mono break-all">{l.url}</div>
                <button onClick={() => { navigator.clipboard.writeText(l.url); toast.success('Copied') }}
                  className="flex-shrink-0 p-2 bg-[var(--accent)] text-white rounded-lg hover:brightness-110 transition"><Copy size={15} /></button>
                <a href={l.url} target="_blank" rel="noopener noreferrer"
                  className="flex-shrink-0 p-2 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-lg hover:bg-[var(--line)] transition"><ExternalLink size={15} /></a>
              </div>
              {l.poster?.full_name && <div className="text-[11px] text-[var(--ink-faint)] mt-2">Posted by {l.poster.full_name}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

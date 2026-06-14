'use client'
import { CONFIG } from '@/lib/config'
import { useState, useEffect } from 'react'

import type { Profile, Application } from '@/types'
import { toast } from 'sonner'
import { Copy, ExternalLink, TrendingUp } from 'lucide-react'

export default function MarketerLink() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState({ total: 0, paid: 0, converted: 0 })
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  async function generateLink() {
    setGenerating(true)
    try {
      const ec = await fetch('/api/marketer/ensure-code', { method: 'POST' }).then(r => r.json())
      if (ec?.marketer_code) {
        setProfile(p => p ? { ...p, marketer_code: ec.marketer_code } : p)
        toast.success('Your link is ready')
      } else {
        toast.error(ec?.error || 'Could not generate link')
      }
    } catch (e: any) {
      toast.error('Could not generate link. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  useEffect(() => {
    async function load() {
      const s = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null)
      if (!s?.valid) { setLoading(false); return }

      const params = new URLSearchParams({
        table: 'profiles', select: '*',
        filters: JSON.stringify([{ col: 'id', op: 'eq', val: s.userId }]),
        limit: '1',
      })
      const profRes = await fetch(`/api/data?${params}`).then(r => r.json())
      let p = profRes.data?.[0] || null

      // If the marketer has no registration link code yet, generate one
      if (p && !p.marketer_code) {
        try {
          const ec = await fetch('/api/marketer/ensure-code', { method: 'POST' }).then(r => r.ok ? r.json() : null)
          if (ec?.marketer_code) p = { ...p, marketer_code: ec.marketer_code }
        } catch {}
      }
      setProfile(p)
      setLoading(false)

      if (p) {
        const appParams = new URLSearchParams({
          table: 'applications', select: '*,course:course_id(name)',
          filters: JSON.stringify([{ col: 'marketer_id', op: 'eq', val: s.userId }]),
          orderBy: 'created_at', orderAsc: 'false', limit: '500',
        })
        const appRes = await fetch(`/api/data?${appParams}`).then(r => r.json())
        const apps: any[] = appRes.data || []
        setApplications(apps)
        setStats({
          total: apps.length,
          paid: apps.filter(a => a.payment_status === 'paid').length,
          converted: apps.filter(a => a.is_submitted).length,
        })
      }
    }
    load()
  }, [])

  const appUrl = profile?.marketer_code
    ? `${CONFIG.appUrl}/apply/${profile.marketer_code}`
    : null

  function copy() {
    if (!appUrl) return
    navigator.clipboard.writeText(appUrl)
    toast.success('Link copied!')
  }

  return (
    <div className="fade-in w-full">
      <div className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-2">My work</div>
        <h1 className="font-display text-[28px] leading-tight font-semibold text-[var(--ink)]">My registration link</h1>
        <p className="text-[var(--ink-soft)] text-sm mt-1.5">Send this to a lead who's ready to register. Everything they pay is tracked to you.</p>
      </div>

      {/* Link card */}
      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-6 mb-5">
        <p className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.1em] mb-2">Your unique application URL</p>
        {appUrl ? (
          <div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-[var(--line-soft)] border border-[var(--line)] rounded-lg px-4 py-3 text-sm text-[var(--ink-soft)] font-mono break-all">
                {appUrl}
              </div>
              <button onClick={copy} className="flex-shrink-0 p-3 bg-[var(--accent)] text-white rounded-lg hover:brightness-110 transition">
                <Copy size={18} />
              </button>
              <a href={appUrl} target="_blank" className="flex-shrink-0 p-3 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-lg hover:bg-[var(--line)] transition">
                <ExternalLink size={18} />
              </a>
            </div>
            <a href={`https://wa.me/?text=${encodeURIComponent(`Hello, here is your registration link for Cambridge Centre of Excellence:\n\n${appUrl}\n\nClick it to fill in your details and pay your registration fee. Once that's done you're registered and we'll take it from there.`)}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-3 h-10 px-4 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:opacity-90 transition">
              Share on WhatsApp
            </a>
          </div>
        ) : loading ? (
          <p className="text-sm text-[var(--ink-faint)]">Loading your link…</p>
        ) : (
          <div>
            <p className="text-sm text-[var(--ink-soft)] mb-3">You don't have a registration link yet. Generate one now — it's unique to you, and every payment made through it is tracked to your name.</p>
            <button onClick={generateLink} disabled={generating}
              className="inline-flex items-center gap-2 h-10 px-4 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:brightness-110 disabled:opacity-50 transition">
              {generating ? 'Generating…' : 'Generate my link'}
            </button>
          </div>
        )}
        <p className="text-xs text-[var(--ink-faint)] mt-3">
          Share this link on WhatsApp, social media, or via email. All applications submitted through your link are tracked to you.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label: 'Applications', value: stats.total },
          { label: 'Paid', value: stats.paid },
          { label: 'Submitted', value: stats.converted },
        ].map(s => (
          <div key={s.label} className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]">{s.label}</div>
            <div className="font-display text-[26px] font-semibold text-[var(--ink)] mt-2 leading-none">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Applications table */}
      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--line)]">
          <h3 className="text-sm font-semibold text-[var(--ink)]">Registrations via your link</h3>
        </div>
        {applications.length === 0 ? (
          <div className="text-center py-12 text-[var(--ink-faint)]">
            <TrendingUp size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No registrations yet. Share your link with a ready lead.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--line-soft)]">
                <tr>
                  {['Name','Email','Course','Payment','Date'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {applications.map(a => (
                  <tr key={a.id} className="border-t border-[var(--line-soft)] hover:bg-[var(--line-soft)]">
                    <td className="px-4 py-3 text-sm font-medium text-[var(--ink)]">{a.full_name}</td>
                    <td className="px-4 py-3 text-sm text-[var(--ink-soft)]">{a.email}</td>
                    <td className="px-4 py-3 text-sm text-[var(--ink-soft)]">{(a as any).course?.name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${a.payment_status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {a.payment_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--ink-faint)]">{new Date(a.created_at).toLocaleDateString('en-GH')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

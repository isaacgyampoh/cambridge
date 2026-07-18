'use client'
import { CONFIG } from '@/lib/config'
import { useState, useEffect } from 'react'

import type { Profile, Application } from '@/types'
import { toast } from 'sonner'
import { Copy, ExternalLink, TrendingUp } from 'lucide-react'
import SharedLinks from '@/components/shared/SharedLinks'

export default function MarketerLink() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState({ total: 0, paid: 0, converted: 0 })
  const [sessionJoins, setSessionJoins] = useState<{ total: number; sessions: any[] }>({ total: 0, sessions: [] })
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  async function generateLink() {
    setGenerating(true)
    try {
      const ec = await fetch('/api/marketer/ensure-code', { method: 'POST' }).then(r => r.json())
      if (ec?.marketer_code) {
        // Build/merge the profile so the link renders even if profile was null
        setProfile(p => ({ ...(p || {}), marketer_code: ec.marketer_code } as any))
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

      fetch('/api/info-sessions/my-joins').then(r => r.json()).then(setSessionJoins).catch(() => {})

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
        <div className="text-[13px] font-medium text-[var(--ink-faint)] mb-2">My work</div>
        <h1 className="font-display text-[28px] leading-tight font-semibold text-[var(--ink)]">My links</h1>
        <p className="text-[var(--ink-soft)] text-sm mt-1.5">Your registration link is always here. Other links shared by the office appear above it and update automatically.</p>
      </div>

      {/* Shared links from the office (Zoom, info session, etc.) */}
      <SharedLinks />

      {/* Info-session joins through my link */}
      {sessionJoins.total > 0 && (
        <div className="bg-[var(--accent-soft)] border border-[var(--accent)]/15 rounded-xl p-5 mb-5">
          <div className="flex items-baseline gap-2">
            <span className="text-[26px] font-semibold text-[var(--accent)]">{sessionJoins.total}</span>
            <span className="text-[14px] text-[var(--ink)]">people joined info sessions through your link</span>
          </div>
          {sessionJoins.sessions.length > 0 && (
            <div className="mt-3 space-y-1">
              {sessionJoins.sessions.map((s: any, i: number) => (
                <div key={i} className="flex justify-between text-[13px] text-[var(--ink-soft)]">
                  <span className="truncate pr-3">{s.title}</span>
                  <span className="font-medium text-[var(--ink)] flex-shrink-0">{s.count}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[12px] text-[var(--ink-faint)] mt-3">These joins are counted for you — anyone who joins through your shared link stays tied to you.</p>
        </div>
      )}

      {/* Link card */}
      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-6 mb-5">
        <p className="text-[12px] font-semibold text-[var(--ink-faint)] mb-2">Your registration link (always yours)</p>
        {appUrl ? (
          <div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-[var(--line-soft)] border border-[var(--line)] rounded-lg px-4 py-3 text-sm text-[var(--ink-soft)] font-mono break-all">
                {appUrl}
              </div>
              <button onClick={copy} className="flex-shrink-0 p-3 bg-[var(--accent)] text-white rounded-lg hover:brightness-110 transition">
                
              </button>
              <a href={appUrl} target="_blank" className="flex-shrink-0 p-3 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-lg hover:bg-[var(--line)] transition">
                
              </a>
            </div>
            <a href={`https://wa.me/?text=${encodeURIComponent(`Hello, here is your registration link for Cambridge Center of Excellence:\n\n${appUrl}\n\nClick it to fill in your details and pay your registration fee. Once that's done you're registered and we'll take it from there.`)}`}
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

      {/* Referral / flyer link — for casual sharing (status, flyers). Friend
          leaves interest first, becomes YOUR lead, AI engages them on WhatsApp. */}
      {profile?.marketer_code && (
        <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-6 mb-5">
          <p className="text-[12px] font-semibold text-[var(--accent)] mb-1">Your referral link (for flyers & status)</p>
          <p className="text-[13px] text-[var(--ink-soft)] mb-3">Post this anywhere. Anyone who clicks it and leaves their details becomes <b>your</b> lead — our WhatsApp AI greets them, answers their questions, and sends the registration form when they're ready.</p>
          {(() => {
            const referUrl = `${CONFIG.appUrl}/refer?m=${profile.marketer_code}`
            return (
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-[var(--line-soft)] border border-[var(--line)] rounded-lg px-4 py-3 text-sm text-[var(--ink-soft)] font-mono break-all">{referUrl}</div>
                  <button onClick={() => { navigator.clipboard.writeText(referUrl); toast.success('Referral link copied!') }}
                    className="flex-shrink-0 h-11 px-4 bg-[var(--accent)] text-white rounded-lg text-sm font-semibold hover:brightness-110 transition">Copy</button>
                </div>
                <a href={`https://wa.me/?text=${encodeURIComponent(`Interested in professional training with Cambridge Center of Excellence? Tap here and I'll get you all the details:\n\n${referUrl}`)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 mt-3 h-10 px-4 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:opacity-90 transition">
                  Share on WhatsApp
                </a>
              </div>
            )
          })()}
          <p className="text-xs text-[var(--ink-faint)] mt-3">
            Difference: the <b>registration link</b> goes straight to the payment form. This <b>referral link</b> is softer — for people who want to ask questions first. Both count toward your numbers.
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label: 'Applications', value: stats.total },
          { label: 'Paid', value: stats.paid },
          { label: 'Submitted', value: stats.converted },
        ].map(s => (
          <div key={s.label} className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
            <div className="text-[13px] font-medium text-[var(--ink-faint)]">{s.label}</div>
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
            
            <p className="text-sm">No registrations yet. Share your link with a ready lead.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="rtc w-full">
              <thead className="bg-[var(--line-soft)]">
                <tr>
                  {['Name','Email','Course','Payment','Date'].map(h => (
                    <th key={h} className="text-left text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {applications.map(a => (
                  <tr key={a.id} className="border-t border-[var(--line-soft)] hover:bg-[var(--line-soft)]">
                    <td data-label="Name" className="px-4 py-3 text-sm font-medium text-[var(--ink)]">{a.full_name}</td>
                    <td data-label="Email" className="px-4 py-3 text-sm text-[var(--ink-soft)]">{a.email}</td>
                    <td data-label="Course" className="px-4 py-3 text-sm text-[var(--ink-soft)]">{(a as any).course?.name || '—'}</td>
                    <td data-label="Payment" className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${a.payment_status === 'paid' ? 'bg-[var(--ok-soft)] text-[var(--ok)]' : 'bg-[var(--warn-soft)] text-[var(--warn)]'}`}>
                        {a.payment_status}
                      </span>
                    </td>
                    <td data-label="Date" className="px-4 py-3 text-xs text-[var(--ink-faint)]">{new Date(a.created_at).toLocaleDateString('en-GH')}</td>
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

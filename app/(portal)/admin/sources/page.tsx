'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Spinner, EmptyState, Badge, inputClass } from '@/components/ui'
import { TrendingUp, Link2, Copy, Megaphone } from 'lucide-react'
import { toast } from 'sonner'
import { CONFIG } from '@/lib/config'

const PLATFORMS = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'google', label: 'Google' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'youtube', label: 'YouTube' },
]

export default function LeadSources() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  // link builder
  const [marketerCode, setMarketerCode] = useState('')
  const [platform, setPlatform] = useState('facebook')
  const [campaign, setCampaign] = useState('')

  useEffect(() => {
    fetch('/api/analytics/sources').then(r => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const builtLink = (() => {
    const base = `${CONFIG.appUrl}/apply/${marketerCode || 'MARKETER_CODE'}`
    const p = new URLSearchParams({ utm_source: platform, utm_medium: 'paid_social' })
    if (campaign.trim()) p.set('utm_campaign', campaign.trim().replace(/\s+/g, '_').toLowerCase())
    return `${base}?${p.toString()}`
  })()

  const maxApps = data?.sources?.[0]?.applications || 1

  return (
    <div className="fade-in w-full">
      <PageHeader eyebrow="Marketing" title="Lead sources"
        description="See which platforms and campaigns bring your leads and registrations — then build tracking links for your ads." />

      {/* Link builder */}
      <Card className="p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Link2 size={16} className="text-[var(--accent)]" />
          <h2 className="font-display font-semibold text-[var(--ink)]">Build a tracking link</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-[13px] font-medium text-[var(--ink)] mb-2 block">Marketer code</label>
            <input value={marketerCode} onChange={e => setMarketerCode(e.target.value)} placeholder="e.g. AMA01" className={inputClass} />
          </div>
          <div>
            <label className="text-[13px] font-medium text-[var(--ink)] mb-2 block">Platform</label>
            <select value={platform} onChange={e => setPlatform(e.target.value)} className={inputClass}>
              {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[13px] font-medium text-[var(--ink)] mb-2 block">Campaign name (optional)</label>
            <input value={campaign} onChange={e => setCampaign(e.target.value)} placeholder="e.g. april_pmp" className={inputClass} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-[var(--canvas)] rounded-lg px-3 py-2.5 text-[var(--ink-soft)] truncate">{builtLink}</code>
          <button onClick={() => { navigator.clipboard.writeText(builtLink); toast.success('Tracking link copied') }}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[var(--accent)] text-white text-xs font-medium flex-shrink-0">
            <Copy size={13} /> Copy
          </button>
        </div>
        <p className="text-[11px] text-[var(--ink-faint)] mt-3">Use this exact link in your Facebook / Google / LinkedIn ad. When someone registers through it, the system records that they came from {PLATFORMS.find(p => p.id === platform)?.label}.</p>
      </Card>

      {/* Source breakdown */}
      {loading ? <Spinner /> : !data?.sources?.length ? (
        <EmptyState icon={<TrendingUp size={20} />} title="No source data yet"
          description="Once people register through your tracking links, the breakdown shows here." />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-4">By platform</h3>
              <div className="space-y-3">
                {data.sources.map((s: any) => (
                  <div key={s.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-[var(--ink)]">{s.label}</span>
                      <span className="text-xs text-[var(--ink-soft)]">{s.applications} leads · <span className="text-[var(--ok)] font-semibold">{s.registrations} registered</span></span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--line-soft)] overflow-hidden">
                      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(s.applications / maxApps) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Megaphone size={14} className="text-[var(--ink-faint)]" />
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)]">By campaign</h3>
              </div>
              {!data.campaigns?.length ? (
                <p className="text-sm text-[var(--ink-faint)]">No named campaigns yet. Add a campaign name when building links to track them individually.</p>
              ) : (
                <div className="space-y-2">
                  {data.campaigns.map((c: any) => (
                    <div key={c.campaign + c.source} className="flex items-center justify-between py-2 border-b border-[var(--line-soft)] last:border-0">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--ink)] truncate">{c.campaign}</div>
                        <div className="text-[11px] text-[var(--ink-faint)]">{c.source}</div>
                      </div>
                      <div className="text-xs text-[var(--ink-soft)] flex-shrink-0 ml-3">{c.applications} · <span className="text-[var(--ok)] font-semibold">{c.registrations}</span></div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

'use client'
import { useState } from 'react'
import { PageHeader, Card, Button, Spinner, inputClass, textareaClass} from '@/components/ui'
import { Search, ExternalLink, Sparkles, Eye } from 'lucide-react'
import { toast } from 'sonner'

export default function CompetitorResearch() {
  const [competitor, setCompetitor] = useState('')
  const [adText, setAdText] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [busy, setBusy] = useState(false)

  const metaUrl = competitor
    ? `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=GH&q=${encodeURIComponent(competitor)}`
    : 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=GH'
  const googleUrl = competitor
    ? `https://adstransparency.google.com/?region=GH&query=${encodeURIComponent(competitor)}`
    : 'https://adstransparency.google.com/?region=GH'

  async function analyze() {
    if (!adText.trim()) { toast.error('Paste a competitor ad to analyze'); return }
    setBusy(true)
    try {
      const d = await fetch('/api/content/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'critique', input: `A competitor's ad:\n\n${adText}\n\nAnalyze what they're doing well and how WE (Cambridge Centre of Excellence) could do it better or differently to stand out.`, platform: 'social' }),
      }).then(r => r.json())
      if (d.error) throw new Error(d.error)
      setAnalysis(d.result)
    } catch (e: any) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fade-in w-full">
      <PageHeader eyebrow="Marketing" title="Competitor research"
        description="See what ads competitors are running, and get AI analysis on how to do better." />

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5 items-start">
        {/* LEFT: find competitor ads */}
        <Card className="p-6">
          <label className="text-[14px] font-medium text-[var(--ink)]">Competitor or keyword</label>
          <input value={competitor} onChange={e => setCompetitor(e.target.value)} placeholder="e.g. a training institute name, or 'PMP Ghana'"
            className={inputClass + ' mt-2 mb-4'} />
          <div className="flex flex-col gap-2">
            <a href={metaUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-xl bg-[var(--accent)] text-white text-[15px] font-medium">
              <Eye size={16} /> Meta Ad Library <ExternalLink size={13} />
            </a>
            <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-xl bg-white border border-[var(--line)] text-[var(--ink-soft)] text-[15px] font-medium">
              <Eye size={16} /> Google Ads Transparency <ExternalLink size={13} />
            </a>
          </div>
          <p className="text-[13px] text-[var(--ink-faint)] mt-4 leading-relaxed">These are official public ad libraries — every ad running on Facebook/Instagram and Google. Search a competitor to see exactly what they're publishing in Ghana.</p>
        </Card>

        {/* RIGHT: paste + analyze (the main work area, full width) */}
        <Card className="p-6">
          <label className="text-[16px] font-semibold text-[var(--ink)]">Analyze a competitor's ad</label>
          <p className="text-[14px] text-[var(--ink-soft)] mt-1 mb-3">Paste the text of a competitor ad you found, and the AI will tell you what works and how to beat it.</p>
          <textarea value={adText} onChange={e => setAdText(e.target.value)} rows={12} placeholder="Paste the competitor's ad copy here…"
            className={textareaClass + ' mb-3 min-h-[280px]'} />
          <Button onClick={analyze} disabled={busy} icon={<Sparkles size={16} />}>{busy ? 'Analyzing…' : 'Analyze & advise'}</Button>

          {analysis && (
            <div className="mt-5 rounded-xl bg-[var(--accent-soft)] p-5">
              <div className="flex items-center gap-2 mb-2"><Sparkles size={16} className="text-[var(--accent)]" /><span className="text-[15px] font-semibold text-[var(--ink)]">Analysis &amp; recommendations</span></div>
              <div className="text-[15px] text-[var(--ink-soft)] whitespace-pre-wrap leading-relaxed">{analysis}</div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

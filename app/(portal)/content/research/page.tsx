'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Spinner, inputClass } from '@/components/ui'
import { toast } from 'sonner'

type Tab = 'strategy' | 'competitors' | 'shadow'

export default function SocialStrategy() {
  const [tab, setTab] = useState<Tab>('strategy')

  return (
    <div className="fade-in w-full">
      <PageHeader eyebrow="Social Media" title="Strategy hub"
        description="Plan what to post and when, watch competitors legally, and turn their best ideas into stronger posts for Cambridge." />

      <div className="flex gap-1 mb-6 border-b border-[var(--line)]">
        {([['strategy', 'Strategy & planning'], ['competitors', 'Competitor watch'], ['shadow', 'Shadow a post']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2.5 text-[14px] font-medium border-b-2 -mb-px transition ${tab === k ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--ink-faint)] hover:text-[var(--ink-soft)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'strategy' && <StrategyTab />}
      {tab === 'competitors' && <CompetitorsTab />}
      {tab === 'shadow' && <ShadowTab />}
    </div>
  )
}

/* ── Strategy & planning: AI strategist ── */
function StrategyTab() {
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState('')
  const [resultTitle, setResultTitle] = useState('')

  async function run(kind: string, title: string) {
    setBusy(kind); setResult(''); setResultTitle(title)
    try {
      const d = await fetch('/api/social/strategy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      }).then(r => r.json())
      if (d.error) throw new Error(d.error)
      setResult(d.result)
    } catch (e: any) { toast.error(e.message) }
    finally { setBusy(null) }
  }

  const tools = [
    { kind: 'weekly_plan', title: '7-day posting plan', desc: 'A full week: what to post each day, on which platform, at the best time, and why.' },
    { kind: 'best_times', title: 'Best times to post', desc: 'When your audience in Ghana is actually online — and the reason behind each slot.' },
    { kind: 'content_ideas', title: '10 content ideas', desc: 'Concrete, scroll-stopping ideas tied to your real courses — no generic fluff.' },
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-start">
      <div className="space-y-3">
        {tools.map(t => (
          <Card key={t.kind} className="p-5">
            <h3 className="font-display text-[15px] font-semibold text-[var(--ink)]">{t.title}</h3>
            <p className="text-[13px] text-[var(--ink-soft)] mt-1 mb-3 leading-relaxed">{t.desc}</p>
            <button onClick={() => run(t.kind, t.title)} disabled={!!busy}
              className="h-10 px-4 rounded-xl bg-[var(--accent)] text-white text-[14px] font-semibold hover:brightness-110 disabled:opacity-50 transition">
              {busy === t.kind ? 'Working…' : 'Generate'}
            </button>
          </Card>
        ))}
      </div>

      <Card className="p-6 min-h-[400px]">
        {busy && !result ? (
          <div className="flex items-center justify-center h-64"><Spinner /></div>
        ) : result ? (
          <div>
            <h3 className="font-display text-[16px] font-semibold text-[var(--ink)] mb-4">{resultTitle}</h3>
            <div className="text-[14px] text-[var(--ink)] whitespace-pre-wrap leading-relaxed">{result}</div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <p className="text-[15px] text-[var(--ink-soft)]">Pick a tool on the left to get a concrete, ready-to-use plan.</p>
          </div>
        )}
      </Card>
    </div>
  )
}

/* ── Competitor watch: watchlist + official ad libraries ── */
function CompetitorsTab() {
  const [list, setList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', handle: '', platform: 'facebook', notes: '' })
  const [saving, setSaving] = useState(false)

  async function load() {
    const d = await fetch('/api/social/competitors').then(r => r.json())
    setList(d.competitors || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function add() {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    const d = await fetch('/api/social/competitors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }).then(r => r.json())
    setSaving(false)
    if (d.competitor) { toast.success('Competitor added'); setForm({ name: '', handle: '', platform: 'facebook', notes: '' }); load() }
    else toast.error(d.error || 'Could not add')
  }
  async function remove(id: string) {
    await fetch('/api/social/competitors', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }

  function metaUrl(q: string) { return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=GH&q=${encodeURIComponent(q)}` }
  function googleUrl(q: string) { return `https://adstransparency.google.com/?region=GH&query=${encodeURIComponent(q)}` }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
      <div>
        {loading ? <Spinner /> : list.length === 0 ? (
          <Card className="p-10 text-center">
            <p className="text-[15px] text-[var(--ink-soft)]">No competitors saved yet. Add one on the right to start watching their ads.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {list.map(c => (
              <Card key={c.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-[16px] font-semibold text-[var(--ink)]">{c.name}</h3>
                    {c.handle && <p className="text-[13px] text-[var(--ink-faint)]">{c.handle} · {c.platform}</p>}
                    {c.notes && <p className="text-[13px] text-[var(--ink-soft)] mt-1">{c.notes}</p>}
                    <div className="flex gap-2 mt-3">
                      <a href={metaUrl(c.name)} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-[var(--accent)] hover:underline">See their Meta ads →</a>
                      <a href={googleUrl(c.name)} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-[var(--accent)] hover:underline">Google ads →</a>
                    </div>
                  </div>
                  <button onClick={() => remove(c.id)} className="text-[13px] text-[var(--danger)] font-medium flex-shrink-0">Remove</button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card className="p-6">
        <h3 className="font-display text-[16px] font-semibold text-[var(--ink)] mb-4">Add a competitor</h3>
        <div className="space-y-3">
          <input className={inputClass} placeholder="Name (e.g. a training institute)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input className={inputClass} placeholder="Handle / page (optional)" value={form.handle} onChange={e => setForm(f => ({ ...f, handle: e.target.value }))} />
          <select className={inputClass} value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}>
            <option value="facebook">Facebook / Instagram</option>
            <option value="linkedin">LinkedIn</option>
            <option value="tiktok">TikTok</option>
          </select>
          <textarea className={inputClass + ' resize-none h-auto py-2.5'} rows={2} placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          <button onClick={add} disabled={saving} className="w-full h-11 rounded-xl bg-[var(--accent)] text-white font-semibold text-[15px] hover:brightness-110 disabled:opacity-50 transition">{saving ? 'Adding…' : 'Add to watchlist'}</button>
        </div>
        <p className="text-[12px] text-[var(--ink-faint)] mt-4 leading-relaxed">These open the official public ad libraries — every ad a competitor runs on Facebook/Instagram and Google is legally visible there. This is the reliable, allowed way to watch competitors.</p>
      </Card>
    </div>
  )
}

/* ── Shadow a post: paste + get a stronger version ── */
function ShadowTab() {
  const [adText, setAdText] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [busy, setBusy] = useState(false)

  async function analyze() {
    if (!adText.trim()) { toast.error('Paste a competitor post or ad first'); return }
    setBusy(true)
    try {
      const d = await fetch('/api/social/strategy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'shadow', input: adText }),
      }).then(r => r.json())
      if (d.error) throw new Error(d.error)
      setAnalysis(d.result)
    } catch (e: any) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
      <Card className="p-6">
        <h3 className="font-display text-[16px] font-semibold text-[var(--ink)]">Found a post that's working?</h3>
        <p className="text-[14px] text-[var(--ink-soft)] mt-1 mb-3 leading-relaxed">Paste a competitor's post or ad. You'll get what makes it work, and a stronger Cambridge version — the hook, caption, format and best time to post.</p>
        <textarea value={adText} onChange={e => setAdText(e.target.value)} rows={12} placeholder="Paste the competitor's post or ad copy here…"
          className={inputClass + ' resize-none h-auto py-3'} />
        <button onClick={analyze} disabled={busy} className="mt-3 h-11 px-5 rounded-xl bg-[var(--accent)] text-white font-semibold text-[15px] hover:brightness-110 disabled:opacity-50 transition">{busy ? 'Analyzing…' : 'Show me how to beat it'}</button>
      </Card>

      <Card className="p-6 min-h-[300px]">
        {busy && !analysis ? <div className="flex items-center justify-center h-64"><Spinner /></div>
          : analysis ? <div className="text-[14px] text-[var(--ink)] whitespace-pre-wrap leading-relaxed">{analysis}</div>
          : <div className="flex items-center justify-center h-64 text-center"><p className="text-[15px] text-[var(--ink-soft)]">Your stronger version will appear here.</p></div>}
      </Card>
    </div>
  )
}

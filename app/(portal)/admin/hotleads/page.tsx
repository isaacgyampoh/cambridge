'use client'
import { useState } from 'react'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, StatCard } from '@/components/ui'
import { Flame, RefreshCw, Phone, MessageSquare, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

export default function HotLeadsPage() {
  const { data: leads, loading, refetch } = useData<any>({
    table: 'leads', select: '*, assignee:assigned_to(full_name)',
    orderBy: 'score', orderAsc: false, limit: 500,
  })
  const [scoring, setScoring] = useState(false)
  const [filter, setFilter] = useState<'all' | 'hot' | 'warm' | 'cold'>('all')

  async function rescore() {
    setScoring(true)
    try {
      const res = await fetch('/api/leads/score', { method: 'POST' })
      const d = await res.json()
      if (d.success) toast.success(`Scored ${d.scored} leads — ${d.hot} hot, ${d.warm} warm, ${d.cold} cold`)
      else toast.error(d.error || 'Could not score')
      refetch()
    } catch (e: any) { toast.error(e.message) }
    finally { setScoring(false) }
  }

  const scored = leads.filter((l: any) => l.last_scored_at)
  const hot = leads.filter((l: any) => l.score_label === 'hot')
  const warm = leads.filter((l: any) => l.score_label === 'warm')
  const filtered = filter === 'all' ? scored : leads.filter((l: any) => l.score_label === filter)

  const TONE: Record<string, any> = { hot: 'danger', warm: 'warning', cold: 'muted' }
  const waLink = (l: any) => `https://wa.me/${String(l.phone).replace(/^0/, '233').replace(/\D/g, '')}`

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Intelligence"
        title="Hot leads"
        description="Leads ranked by likelihood to convert, scored from behaviour and engagement signals. Call the hottest first."
        actions={<Button onClick={rescore} disabled={scoring} icon={<RefreshCw size={14} className={scoring ? 'animate-spin' : ''} />}>{scoring ? 'Scoring…' : 'Rescore all'}</Button>}
      />

      {scored.length === 0 && !loading ? (
        <EmptyState icon={<Flame size={22} />} title="No scores yet" description="Run the scoring engine to rank your leads by conversion likelihood." action={<Button onClick={rescore} disabled={scoring}>{scoring ? 'Scoring…' : 'Score leads now'}</Button>} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard label="Hot leads" value={hot.length} sub="call these first" icon={<Flame size={18} />} accent />
            <StatCard label="Warm" value={warm.length} icon={<TrendingUp size={18} />} />
            <StatCard label="Scored" value={scored.length} />
            <StatCard label="Avg score" value={scored.length ? Math.round(scored.reduce((a: number, l: any) => a + (l.score || 0), 0) / scored.length) : 0} sub="out of 100" />
          </div>

          <div className="flex gap-1 mb-5 bg-[var(--line-soft)] rounded-lg p-1 w-fit">
            {[{ k: 'all', l: `All (${scored.length})` }, { k: 'hot', l: `Hot (${hot.length})` }, { k: 'warm', l: `Warm (${warm.length})` }, { k: 'cold', l: `Cold (${leads.filter((x: any) => x.score_label === 'cold').length})` }].map(t => (
              <button key={t.k} onClick={() => setFilter(t.k as any)}
                className={`px-4 h-8 rounded-md text-[13px] font-medium transition ${filter === t.k ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--ink-faint)] hover:text-[var(--ink)]'}`}>
                {t.l}
              </button>
            ))}
          </div>

          {loading ? <Spinner /> : (
            <div className="space-y-2 stagger">
              {filtered.map((l: any) => (
                <Card key={l.id} className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Score ring */}
                    <div className="flex-shrink-0 relative w-12 h-12">
                      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--line)" strokeWidth="4" />
                        <circle cx="24" cy="24" r="20" fill="none"
                          stroke={l.score_label === 'hot' ? '#dc2626' : l.score_label === 'warm' ? '#d97706' : '#a1a1aa'}
                          strokeWidth="4" strokeLinecap="round"
                          strokeDasharray={`${(l.score / 100) * 125.6} 125.6`} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center font-display text-sm font-semibold text-[var(--ink)]">{l.score}</div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/admin/leads/${l.id}`} className="font-medium text-[var(--ink)] hover:text-[var(--accent)] truncate">{l.full_name}</Link>
                        <Badge tone={TONE[l.score_label]}>{l.score_label}</Badge>
                      </div>
                      <div className="text-xs text-[var(--ink-faint)] mt-0.5">
                        {l.phone?.replace(/^233/, '0')} {l.assignee ? `· ${l.assignee.full_name.split(' ')[0]}` : '· unassigned'}
                      </div>
                      {l.score_reasons?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {l.score_reasons.map((r: string, i: number) => (
                            <span key={i} className="text-[11px] text-[var(--ink-soft)] bg-[var(--line-soft)] px-2 py-0.5 rounded-md">{r}</span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 flex-shrink-0">
                      {l.phone && <>
                        <a href={`tel:${l.phone}`} className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] hover:brightness-95 transition"><Phone size={15} /></a>
                        <a href={waLink(l)} target="_blank" rel="noopener noreferrer" className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#25D366]/10 text-[#1da851] hover:bg-[#25D366]/20 transition"><MessageSquare size={15} /></a>
                      </>}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { PageHeader, Card, StatCard, Spinner, Badge, SectionLabel, Button, Field, inputClass, EmptyState, Sparkline } from '@/components/ui'
import { formatGHS } from '@/lib/utils'
import { Trophy, Wallet, Users, Settings2, X, Award } from 'lucide-react'
import Modal from '@/components/shared/Modal'
import { toast } from 'sonner'

const RANK_TONE = (rank: string): any =>
  rank.startsWith('Omega') ? 'accent' : rank.startsWith('Titan') || rank.startsWith('Delta') ? 'success' : rank === 'Unranked' ? 'muted' : 'warning'

export default function AdminRemuneration() {
  const [board, setBoard] = useState<any[]>([])
  const [totals, setTotals] = useState({ commitment: 0 })
  const [loading, setLoading] = useState(true)
  const [year] = useState(new Date().getFullYear())
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { data: programs, refetch: refetchPrograms } = useData<any>({ table: 'program_points', orderBy: 'sort_order', limit: 50 })
  const { data: bands } = useData<any>({ table: 'rank_bands', orderBy: 'sort_order', limit: 50 })

  async function load() {
    setLoading(true)
    const d = await fetch(`/api/remuneration?scope=all&year=${year}`).then(r => r.json())
    setBoard(d.board || [])
    setTotals({ commitment: d.totalSalaryCommitment || 0 })
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const ranked = board.filter(m => m.rank !== 'Unranked')
  const topRank = board[0]

  async function savePoints(code: string, points: number) {
    try { await mutate('PATCH', 'program_points', { points }, [{ col: 'code', val: code }]); refetchPrograms(); toast.success('Updated') }
    catch (e: any) { toast.error(e.message) }
  }

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow={`${year} remuneration`}
        title="Marketer ranks & salaries"
        description="Live standings from converted enrollments. Points, ranks and salary bands per the CCE Remuneration System."
        actions={<Button variant="secondary" onClick={() => setSettingsOpen(true)} icon={<Settings2 size={14} />}>Point values</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Marketers ranked" value={ranked.length} sub={`of ${board.length}`} icon={<Users size={18} />} />
        <StatCard label="Annual salary commitment" value={formatGHS(totals.commitment)} sub="across all ranked staff" icon={<Wallet size={18} />} accent />
        <StatCard label="Top performer" value={topRank?.name?.split(' ')[0] || '—'} sub={topRank ? `${topRank.points} pts · ${topRank.rank}` : 'No data'} icon={<Trophy size={18} />} />
        <StatCard label="Total points" value={board.reduce((a, m) => a + m.points, 0)} sub="earned this year" icon={<Award size={18} />} />
      </div>

      <SectionLabel>Leaderboard</SectionLabel>
      {loading ? <Spinner /> : board.length === 0 ? (
        <EmptyState icon={<Trophy size={20} />} title="No marketers yet" description="Add marketing staff and credit enrollments to see standings." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-[var(--line)]">
                {['#', 'Marketer', 'Points', 'Trend', 'Rank', 'Gross salary', 'Reg. commission', 'To next rank'].map(h => (
                  <th key={h} className="text-left text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {board.map((m, i) => (
                  <tr key={m.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--line-soft)]">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-bold ${i === 0 ? 'bg-[var(--gold)] text-white' : i < 3 ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--ink-faint)]'}`}>{i + 1}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-[var(--ink)]">{m.name}</div>
                      <div className="text-[12px] text-[var(--ink-faint)]">{m.enrollments} enrollments</div>
                    </td>
                    <td className="px-4 py-3 font-display text-lg font-semibold text-[var(--ink)]">{m.points}</td>
                    <td className="px-4 py-3">{m.trend && m.trend.some((v:number)=>v>0) ? <Sparkline data={m.trend} /> : <span className="text-[12px] text-[var(--ink-faint)]">—</span>}</td>
                    <td className="px-4 py-3"><Badge tone={RANK_TONE(m.rank)}>{m.rank}</Badge></td>
                    <td className="px-4 py-3 text-sm font-semibold text-[var(--ink)]">{formatGHS(m.grossSalary)}</td>
                    <td className="px-4 py-3 text-sm text-[var(--ok)] font-medium">{formatGHS(m.registrationCommission)}</td>
                    <td className="px-4 py-3 text-xs text-[var(--ink-faint)]">{m.nextRank ? `${m.pointsToNext} → ${m.nextRank}` : 'Top rank'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Rank ladder reference */}
      <SectionLabel>Rank ladder</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {bands.map((b: any) => (
          <Card key={b.id} className="p-4">
            <div className="font-display text-base font-semibold text-[var(--ink)]">{b.name}</div>
            <div className="text-xs text-[var(--ink-faint)] mt-0.5">{b.min_points}{b.max_points ? `–${b.max_points}` : '+'} pts</div>
            <div className="text-sm font-semibold text-[var(--accent)] mt-2">{formatGHS(b.gross_salary)}</div>
          </Card>
        ))}
      </div>

      {/* Point values settings */}
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="max-w-md">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">Programme point values</h2>
            <button onClick={() => setSettingsOpen(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"><X size={20} /></button>
          </div>
          <p className="text-sm text-[var(--ink-soft)] mb-5">Points each enrolled student earns the marketer. Corporate is a 40–200 valuation entered per deal.</p>
          <div className="space-y-3">
            {programs.map((p: any) => (
              <div key={p.code} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--ink)]">{p.name}</div>
                  <div className="text-[12px] text-[var(--ink-faint)] font-mono">{p.code}{p.is_corporate ? ' · 40–200' : ''}</div>
                </div>
                <input type="number" defaultValue={p.points} disabled={p.is_corporate}
                  onBlur={e => { const v = parseFloat(e.target.value); if (v !== p.points) savePoints(p.code, v) }}
                  className="w-20 h-9 px-3 rounded-lg border border-[var(--line)] text-sm text-center focus:outline-none focus:border-[var(--accent)] disabled:bg-[var(--line-soft)] disabled:text-[var(--ink-faint)]" />
              </div>
            ))}
          </div>
          <Button onClick={() => setSettingsOpen(false)} className="w-full mt-6">Done</Button>
        </div>
      </Modal>
    </div>
  )
}

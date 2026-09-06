'use client'
import { useState, useEffect } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { PageHeader, Card, StatCard, Badge, SectionLabel, Button, Sparkline } from '@/components/ui'
import { formatGHS } from '@/lib/utils'
import { DataTable, type Column } from '@/components/ui/DataTable'
import Modal from '@/components/shared/Modal'
import { toast } from 'sonner'

const RANK_TONE = (rank: string): any =>
  rank.startsWith('Omega') ? 'accent' : rank.startsWith('Titan') || rank.startsWith('Delta') ? 'success' : rank === 'Unranked' ? 'muted' : 'warning'

type BoardRow = {
  id: string
  name: string
  enrollments: number
  points: number
  trend?: number[]
  rank: string
  grossSalary: number
  registrationCommission: number
  nextRank?: string | null
  pointsToNext?: number
}

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

  const boardColumns: Column<BoardRow>[] = [
    {
      key: 'rank_no', header: '#', hideOnMobile: true,
      render: m => {
        const i = board.indexOf(m)
        return (
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-bold
            ${i === 0 ? 'bg-[var(--gold)] text-white'
              : i < 3 ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'text-[var(--ink-faint)]'}`}>
            {i + 1}
          </span>
        )
      },
    },
    { key: 'name', header: 'Marketer', primary: true, render: m => m.name },
    {
      key: 'enrollments', header: 'Enrollments', secondary: true,
      render: m => `${m.enrollments} enrollments`,
    },
    {
      key: 'points', header: 'Points', numeric: true,
      render: m => <span className="font-semibold text-[var(--ink)]">{m.points}</span>,
    },
    {
      key: 'trend', header: 'Trend', hideOnMobile: true,
      render: m => m.trend && m.trend.some(v => v > 0)
        ? <Sparkline data={m.trend} />
        : <span className="text-[12px] text-[var(--ink-faint)]">—</span>,
    },
    { key: 'rank', header: 'Rank', render: m => <Badge tone={RANK_TONE(m.rank)}>{m.rank}</Badge> },
    {
      key: 'salary', header: 'Gross salary', numeric: true,
      render: m => <span className="font-semibold">{formatGHS(m.grossSalary)}</span>,
    },
    {
      key: 'commission', header: 'Commission', numeric: true,
      render: m => <span className="text-[var(--ok)] font-medium">{formatGHS(m.registrationCommission)}</span>,
    },
    {
      key: 'next', header: 'To next rank',
      render: m => <span className="text-[var(--ink-faint)] text-[12px]">
        {m.nextRank ? `${m.pointsToNext} to ${m.nextRank}` : 'Top rank'}
      </span>,
    },
  ]

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow={`${year} remuneration`}
        title="Marketer ranks & salaries"
        description="Live standings from converted enrollments. Points, ranks and salary bands per the CCE Remuneration System."
        actions={<Button variant="secondary" onClick={() => setSettingsOpen(true)} >Point values</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Marketers ranked" value={ranked.length} sub={`of ${board.length}`}  />
        <StatCard label="Annual salary commitment" value={formatGHS(totals.commitment)} sub="across all ranked staff"  accent />
        <StatCard label="Top performer" value={topRank?.name?.split(' ')[0] || '—'} sub={topRank ? `${topRank.points} pts · ${topRank.rank}` : 'No data'}  />
        <StatCard label="Total points" value={board.reduce((a, m) => a + m.points, 0)} sub="earned this year"  />
      </div>

      <SectionLabel>Leaderboard</SectionLabel>
      <DataTable<BoardRow>
        caption="Marketer standings"
        state={loading ? 'loading' : 'ready'}
        rows={board}
        rowKey={m => m.id}
        columns={boardColumns}
        emptyTitle="No marketers yet"
        emptyMessage="Add marketing staff and credit enrollments to see standings."
      />

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
            <button onClick={() => setSettingsOpen(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"></button>
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

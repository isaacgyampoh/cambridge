'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, StatCard, Spinner, Badge, EmptyState, Sparkline } from '@/components/ui'
import { GraduationCap, TrendingUp, Target, Award } from 'lucide-react'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function ConversionsPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState<string>('')  // '' = whole year, else 'YYYY-MM'
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ year: String(year) })
    if (month) params.set('month', month)
    fetch(`/api/analytics/courses?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [year, month])

  const periodLabel = month
    ? new Date(Number(month.slice(0,4)), Number(month.slice(5,7)) - 1, 1).toLocaleDateString('en-GH', { month: 'long', year: 'numeric' })
    : `${year} (full year)`

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Analysis"
        title="Leads & conversions by course"
        description={data?.scope === 'me'
          ? 'Your leads and how many you converted, broken down by programme.'
          : 'Across the team — how many leads each programme pulled and how many registered.'}
      />

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="h-9 px-3 rounded-lg border border-[var(--line)] bg-white text-sm focus:outline-none focus:border-[var(--accent)]">
          {[0,1,2].map(i => { const y = now.getFullYear() - i; return <option key={y} value={y}>{y}</option> })}
        </select>
        <button onClick={() => setMonth('')}
          className={`h-9 px-3 rounded-lg text-sm font-medium transition ${!month ? 'bg-[var(--accent)] text-white' : 'bg-white border border-[var(--line)] text-[var(--ink-soft)]'}`}>
          Full year
        </button>
        {MONTHS.map((m, i) => {
          const key = `${year}-${String(i+1).padStart(2,'0')}`
          return (
            <button key={m} onClick={() => setMonth(key)}
              className={`h-9 px-3 rounded-lg text-sm font-medium transition ${month === key ? 'bg-[var(--accent)] text-white' : 'bg-white border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink-faint)]'}`}>
              {m}
            </button>
          )
        })}
      </div>

      {loading ? <Spinner /> : !data ? (
        <EmptyState  title="No data" description="Couldn't load the analysis." />
      ) : (
        <>
          {/* Headline stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard label={`Leads · ${periodLabel}`} value={data.totals.leads} 
              spark={data.months.map((m: any) => m.leads)} />
            <StatCard label="Registered" value={data.totals.registered} 
              sub="Converted to students" spark={data.months.map((m: any) => m.registered)} />
            <StatCard label="Conversion rate" value={`${data.totals.convRate}%`}  accent />
          </div>

          {/* Per-course breakdown */}
          <Card className="overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-[var(--line)]">
              <h3 className="font-semibold text-[var(--ink)]">By programme — {periodLabel}</h3>
            </div>
            {data.byCourse.length === 0 || data.byCourse.every((c: any) => c.leads === 0) ? (
              <EmptyState  title="No leads in this period"
                description="When leads come in tagged with a programme, the breakdown shows here." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--line)]">
                      {['Programme', 'Leads', 'Registered', 'Conversion', ''].map(h => (
                        <th key={h} className="text-left text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-5 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCourse.filter((c: any) => c.leads > 0).map((c: any) => (
                      <tr key={c.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--line-soft)] transition">
                        <td className="px-5 py-3.5">
                          <div className="font-medium text-[var(--ink)]">{c.name}</div>
                          {c.code && <div className="text-[12px] text-[var(--ink-faint)]">{c.code}</div>}
                        </td>
                        <td className="px-5 py-3.5 font-display text-lg font-semibold text-[var(--ink)]">{c.leads}</td>
                        <td className="px-5 py-3.5">
                          <span className="font-display text-lg font-semibold text-[var(--ok)]">{c.registered}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 rounded-full bg-[var(--line)] overflow-hidden">
                              <div className="h-full bg-[var(--accent)] rounded-full" style={{ width: `${c.convRate}%` }} />
                            </div>
                            <span className="text-sm font-medium text-[var(--ink-soft)]">{c.convRate}%</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          {c.convRate >= 30 ? <Badge tone="success">Strong</Badge>
                            : c.convRate >= 15 ? <Badge tone="warning">Okay</Badge>
                            : <Badge tone="danger">Low</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.uncategorised > 0 && (
              <div className="px-5 py-3 text-xs text-[var(--ink-faint)] border-t border-[var(--line-soft)]">
                {data.uncategorised} lead{data.uncategorised === 1 ? '' : 's'} not matched to a programme (no course interest set).
              </div>
            )}
          </Card>

          {/* Monthly trend */}
          <Card className="p-5">
            <h3 className="font-semibold text-[var(--ink)] mb-4">Monthly trend · {year}</h3>
            <div className="flex items-end gap-2 h-40">
              {data.months.map((m: any) => {
                const max = Math.max(...data.months.map((x: any) => x.leads), 1)
                const h = (m.leads / max) * 100
                const rh = m.leads ? (m.registered / m.leads) * h : 0
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className="w-full flex flex-col justify-end items-center relative" style={{ height: '120px' }}>
                      <div className="w-full max-w-[28px] rounded-t bg-[var(--accent-soft)] relative" style={{ height: `${h}%` }} title={`${m.leads} leads`}>
                        <div className="absolute bottom-0 left-0 right-0 rounded-t bg-[var(--accent)]" style={{ height: `${m.leads ? (m.registered/m.leads)*100 : 0}%` }} title={`${m.registered} registered`} />
                      </div>
                    </div>
                    <span className="text-[10px] text-[var(--ink-faint)]">{m.label}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-4 mt-4 text-xs text-[var(--ink-soft)]">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[var(--accent-soft)]" /> Leads</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[var(--accent)]" /> Registered</span>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

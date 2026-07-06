'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Spinner, EmptyState } from '@/components/ui'

export default function Reports() {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const d = await fetch(`/api/reports?period=${period}`).then(r => r.json())
      setReports(d.reports || [])
    } catch { setReports([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [period])

  return (
    <div className="fade-in w-full">
      <PageHeader eyebrow="Performance" title="Activity reports"
        description="Auto-generated from real activity — no manual filing. Leads handled, contacted, converted, and calls made, per period." />

      <div className="flex gap-1 mb-6 bg-[var(--line-soft)] rounded-xl p-1 w-fit">
        {(['daily', 'weekly', 'monthly'] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-lg text-[14px] font-medium capitalize transition ${period === p ? 'bg-[var(--paper)] text-[var(--ink)] shadow-sm' : 'text-[var(--ink-soft)]'}`}>
            {p}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : reports.length === 0 ? (
        <EmptyState title="No reports yet" description={`${period[0].toUpperCase() + period.slice(1)} reports appear here once the system generates them from activity.`} />
      ) : (
        <div className="space-y-3">
          {reports.map(r => (
            <Card key={r.id} className="p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  {r.marketer_name && <div className="font-display text-[16px] font-semibold text-[var(--ink)]">{r.marketer_name}</div>}
                  <div className="text-[13px] text-[var(--ink-faint)]">{r.period_start} → {r.period_end}</div>
                  <p className="text-[14px] text-[var(--ink-soft)] mt-2 leading-relaxed">{r.summary}</p>
                </div>
                <div className="flex gap-4 flex-shrink-0">
                  {[['Leads', r.new_leads], ['Converted', r.converted], ['Calls', r.calls_made]].map(([l, v]) => (
                    <div key={l as string} className="text-center">
                      <div className="font-display text-[22px] font-semibold text-[var(--ink)]">{v as number}</div>
                      <div className="text-[12px] text-[var(--ink-faint)]">{l as string}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

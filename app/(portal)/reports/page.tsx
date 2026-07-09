'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Spinner, EmptyState } from '@/components/ui'
import { toast } from 'sonner'

export default function Reports() {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState('')
  const [generating, setGenerating] = useState(false)
  const [manualNote, setManualNote] = useState('')
  const [filingManual, setFilingManual] = useState(false)
  const [showManual, setShowManual] = useState(false)

  const isManager = role === 'super_admin' || role === 'project_manager'

  async function load() {
    setLoading(true)
    try {
      const d = await fetch(`/api/reports?period=${period}`).then(r => r.json())
      setReports(d.reports || [])
    } catch { setReports([]) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(s => { if (s.valid) setRole(s.role) }).catch(() => {})
  }, [])
  useEffect(() => { load() }, [period])

  async function generateNow() {
    setGenerating(true)
    toast.loading('Generating reports…', { id: 'gen' })
    const d = await fetch('/api/reports/generate-now', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period }),
    }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    setGenerating(false)
    if (d.success) { toast.success(`Generated ${d.generated || 0} report(s).`, { id: 'gen' }); load() }
    else toast.error(d.error || 'Could not generate', { id: 'gen' })
  }

  async function fileManual() {
    if (!manualNote.trim()) return
    setFilingManual(true)
    const d = await fetch('/api/reports/manual', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period, note: manualNote }),
    }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    setFilingManual(false)
    if (d.success) { toast.success('Report filed — your PM has been notified.'); setManualNote(''); setShowManual(false); load() }
    else toast.error(d.error || 'Could not file report')
  }

  return (
    <div className="fade-in w-full">
      <PageHeader eyebrow="Performance" title="Activity reports"
        description="Auto-generated from your activity — leads handled, contacted, converted, and calls made. You can also write your own report."
        actions={
          <div className="flex gap-2">
            <button onClick={() => setShowManual(s => !s)}
              className="h-10 px-4 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--ink)] hover:bg-[var(--canvas)] transition">
              Write my report
            </button>
            {isManager && (
              <button onClick={generateNow} disabled={generating}
                className="h-10 px-4 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
                {generating ? 'Generating…' : 'Generate now'}
              </button>
            )}
          </div>
        } />

      {showManual && (
        <Card className="p-6 mb-5">
          <h3 className="font-display text-[16px] font-semibold text-[var(--ink)] mb-1">Write your {period} report</h3>
          <p className="text-[13px] text-[var(--ink-soft)] mb-3">Anything you want your PM to know — wins, challenges, plans. This is filed alongside the automatic figures.</p>
          <textarea value={manualNote} onChange={e => setManualNote(e.target.value)} rows={5}
            placeholder="e.g. Closed 3 PMP registrations this week. Two leads asked about scholarships — following up Monday…"
            className="w-full px-4 py-3 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] resize-none" />
          <div className="flex gap-2 mt-3">
            <button onClick={fileManual} disabled={filingManual || !manualNote.trim()}
              className="h-10 px-5 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
              {filingManual ? 'Filing…' : 'File report'}
            </button>
            <button onClick={() => setShowManual(false)} className="h-10 px-4 rounded-xl text-sm font-medium text-[var(--ink-soft)]">Cancel</button>
          </div>
        </Card>
      )}

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
                  <p className="text-[14px] text-[var(--ink-soft)] mt-2 leading-relaxed whitespace-pre-wrap">{r.is_manual && r.manual_note ? r.manual_note : r.summary}</p>
                  {r.is_manual && <span className="inline-block mt-2 text-[11px] font-semibold text-[var(--accent)] bg-[var(--accent-soft)] px-2 py-0.5 rounded-full">Written by staff</span>}
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

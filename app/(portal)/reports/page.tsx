'use client'
import { useState, useEffect, useCallback } from 'react'
import { PageHeader, Card, Button, Badge, Tabs, MobileList, ListRow, Avatar } from '@/components/ui'
import { FileText, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

type Report = {
  id: string
  marketer_name?: string | null
  period_start: string
  period_end: string
  summary?: string | null
  manual_note?: string | null
  is_manual?: boolean
  new_leads: number
  converted: number
  calls_made: number
}

export default function Reports() {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState('')
  const [generating, setGenerating] = useState(false)
  const [manualNote, setManualNote] = useState('')
  const [filingManual, setFilingManual] = useState(false)
  const [showManual, setShowManual] = useState(false)

  const isManager = role === 'super_admin' || role === 'project_manager'

  /*
   * Fetching and applying are separate so the effect never sets state
   * synchronously — see the note in hooks/useData. `load` keeps the spinner
   * for the manual paths: filing a report, or generating one.
   */
  const fetchReports = useCallback(async (): Promise<Report[] | null> => {
    try {
      const d = await fetch(`/api/reports?period=${period}`).then(r => r.json())
      return (d.reports || []) as Report[]
    } catch {
      return null
    }
  }, [period])

  const apply = useCallback((rows: Report[] | null) => {
    // A failed request is not "no reports yet" — that would read as though
    // nobody had filed anything.
    if (!rows) toast.error('Could not load the reports.')
    setReports(rows || [])
    setLoading(false)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    apply(await fetchReports())
  }, [apply, fetchReports])

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(s => { if (s.valid) setRole(s.role) }).catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    fetchReports().then(rows => { if (alive) apply(rows) })
    return () => { alive = false }
  }, [fetchReports, apply])

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
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader eyebrow="Performance" title="Activity reports"
        description="Auto-generated from your activity — leads handled, contacted, converted, and calls made. You can also write your own report."
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowManual(v => !v)}>
              <FileText size={16} aria-hidden="true" /> Write my report
            </Button>
            {isManager && (
              <Button onClick={generateNow} disabled={generating}>
                <Sparkles size={16} aria-hidden="true" />
                {generating ? 'Generating…' : 'Generate now'}
              </Button>
            )}
          </>
        } />

      {showManual && (
        <Card className="p-6 mb-5">
          <h3 className="font-display text-[15px] font-semibold text-[var(--ink)] mb-1">Write your {period} report</h3>
          <p className="text-[13px] text-[var(--ink-soft)] mb-3">Anything you want your PM to know — wins, challenges, plans. This is filed alongside the automatic figures.</p>
          <textarea value={manualNote} onChange={e => setManualNote(e.target.value)} rows={5}
            placeholder="e.g. Closed 3 PMP registrations this week. Two leads asked about scholarships — following up Monday…"
            className="w-full px-4 py-3 rounded-2xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] resize-none" />
          <div className="flex gap-2 mt-3">
            <button onClick={fileManual} disabled={filingManual || !manualNote.trim()}
              className="h-10 px-5 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
              {filingManual ? 'Filing…' : 'File report'}
            </button>
            <button onClick={() => setShowManual(false)} className="h-10 px-4 rounded-xl text-sm font-medium text-[var(--ink-soft)]">Cancel</button>
          </div>
        </Card>
      )}

      <Tabs
        tabs={[
          { key: 'daily', label: 'Daily' },
          { key: 'weekly', label: 'Weekly' },
          { key: 'monthly', label: 'Monthly' },
        ]}
        active={period}
        onChange={k => { setLoading(true); setPeriod(k as typeof period) }}
        label="Reporting period"
        className="mb-5"
      />

      <MobileList
        rows={reports}
        rowKey={r => r.id}
        state={loading ? 'loading' : 'ready'}
        emptyTitle="No reports yet"
        emptyMessage={`${period[0].toUpperCase()}${period.slice(1)} reports appear here once the system generates them from activity.`}
        renderRow={r => (
          <ListRow
            leading={r.marketer_name ? <Avatar name={r.marketer_name} size="md" /> : undefined}
            title={r.marketer_name || 'Activity report'}
            subtitle={`${r.period_start} → ${r.period_end}`}
            status={r.is_manual ? <Badge tone="accent">Written by staff</Badge> : undefined}
            meta={
              <>
                <span className="numeric">{r.new_leads} leads</span>
                <span className="numeric">{r.converted} converted</span>
                <span className="numeric">{r.calls_made} calls</span>
              </>
            }
            subrow={
              <p className="text-[13px] text-[var(--ink-soft)] leading-relaxed whitespace-pre-wrap">
                {r.is_manual && r.manual_note ? r.manual_note : r.summary}
              </p>
            }
          />
        )}
      />

    </div>
  )
}

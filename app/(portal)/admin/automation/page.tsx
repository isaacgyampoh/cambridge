'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Spinner, Badge } from '@/components/ui'
import { useData } from '@/hooks/useData'
import { toast } from 'sonner'

const LABELS: Record<string, { name: string; desc: string; every: string }> = {
  lead_notify:        { name: 'Lead alerts to marketers', desc: 'One consolidated SMS per marketer for new leads', every: '5 min' },
  sequences:          { name: 'Follow-up sequences', desc: 'Nurture messages to leads on schedule', every: '15 min' },
  class_start:        { name: 'Class starting reminders', desc: '30 minutes before class, with what they owe', every: '10 min' },
  info_sessions:      { name: 'Info session invites', desc: 'Broadcasts the session to your audience', every: '15 min' },
  info_followup:      { name: 'Info session follow-up', desc: 'Asks attendees if it was clear', every: '30 min' },
  class_reminders:    { name: 'Class reminders', desc: 'Scheduled class notices', every: '15 min' },
  paystack_reconcile: { name: 'Payment self-heal', desc: 'Fixes payments that did not complete', every: 'hourly' },
  prep_reminders:     { name: 'Exam prep reminders', desc: 'Voucher expiry, tips, good wishes', every: 'twice daily' },
  payment_reminders:  { name: 'Fee reminders', desc: 'Chases outstanding balances', every: 'daily' },
  reports:            { name: 'Reports', desc: 'Generates performance reports', every: 'daily' },
  tiers:              { name: 'Performance tiers', desc: 'Recalculates marketer tiers', every: 'weekly' },
}

export default function AutomationPage() {
  const { data: runs, loading, refetch } = useData<any>({ table: 'cron_runs', select: '*', limit: 50 })
  const [busy, setBusy] = useState<string | null>(null)

  const ago = (t: string) => {
    if (!t) return 'never'
    const m = Math.floor((Date.now() - new Date(t).getTime()) / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m} min ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
    return `${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? '' : 's'} ago`
  }

  async function runNow(task?: string) {
    setBusy(task || 'all')
    const d = await fetch(`/api/cron/run?key=1024${task ? `&task=${task}` : ''}`).then(r => r.json()).catch(() => ({ error: 'failed' }))
    setBusy(null)
    if (d.error) toast.error(d.error)
    else { toast.success(`Ran ${d.ran} task${d.ran === 1 ? '' : 's'}`); refetch() }
  }

  const byTask: Record<string, any> = {}
  for (const r of runs || []) byTask[r.task] = r
  const neverRun = Object.keys(LABELS).filter(k => !byTask[k])

  return (
    <div className="fade-in w-full max-w-3xl">
      <PageHeader eyebrow="System" title="Automation"
        description="Every scheduled job the system runs. One cron drives them all."
        actions={<Button onClick={() => runNow()} disabled={busy === 'all'}>{busy === 'all' ? 'Running…' : 'Run due now'}</Button>} />

      <Card className="p-4 mb-5 bg-[var(--accent-soft)] border-[var(--accent)]/15">
        <div className="text-[13px] font-semibold text-[var(--ink)] mb-1">Set up once</div>
        <p className="text-[13px] text-[var(--ink-soft)] leading-relaxed">
          At cron-job.org create a single job calling this URL every <b>5 minutes</b>:
        </p>
        <code className="block mt-2 text-[12px] bg-white border border-[var(--line)] rounded-lg px-3 py-2 break-all">
          https://portal.cambridge.edu.gh/api/cron/run?key=1024
        </code>
      </Card>

      {loading ? <Spinner /> : (
        <div className="space-y-2">
          {Object.entries(LABELS).map(([key, l]) => {
            const r = byTask[key]
            const failed = r?.last_status === 'failed'
            return (
              <Card key={key} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--ink)] text-[14px]">{l.name}</span>
                      {r ? <Badge tone={failed ? 'danger' : 'success'}>{failed ? 'Failed' : 'OK'}</Badge>
                         : <Badge tone="neutral">Not yet run</Badge>}
                    </div>
                    <div className="text-[12.5px] text-[var(--ink-soft)] mt-1">{l.desc}</div>
                    <div className="text-[12px] text-[var(--ink-faint)] mt-1">
                      Runs {l.every} · last {ago(r?.last_run_at)}
                    </div>
                    {failed && r?.last_detail && (
                      <div className="text-[12px] text-[var(--danger)] mt-1 break-all">{r.last_detail.slice(0, 160)}</div>
                    )}
                  </div>
                  <button onClick={() => runNow(key)} disabled={busy === key}
                    className="text-[12px] font-semibold text-[var(--accent)] flex-shrink-0">
                    {busy === key ? '…' : 'Run now'}
                  </button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {neverRun.length > 0 && !loading && (
        <p className="text-[12.5px] text-[var(--ink-faint)] mt-4">
          Tasks showing “Not yet run” simply have not fired since the scheduler was set up.
        </p>
      )}
    </div>
  )
}

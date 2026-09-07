'use client'
import { useState } from 'react'
import { PageHeader, Card, Button, Spinner, Badge } from '@/components/ui'
import { useData } from '@/hooks/useData'
import { toast } from 'sonner'
import type { CronRun } from '@/types'

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

/*
 * How long ago, as a sentence. Module scope: reading the clock is not a
 * render-time job, and React 19 reports it as an impure render.
 */
function ago(t: string | null | undefined) {
  if (!t) return 'never'
  const m = Math.floor((Date.now() - new Date(t).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function AutomationPage() {
  const { data: runs, loading, refetch } = useData<CronRun>({ table: 'cron_runs', select: '*', limit: 50 })
  const [busy, setBusy] = useState<string | null>(null)

  /*
   * Run the due tasks now.
   *
   * Posts to /api/admin/run-cron, which checks the session and then speaks to
   * the cron runner with the real secret server-side. This used to call
   * /api/cron/run?key=1024 directly from the browser — CRON_SECRET is not
   * 1024, so the button had never once worked, and it could not have: putting
   * the real secret here would hand it to anyone who opened the page.
   */
  async function runNow(task?: string) {
    setBusy(task || 'all')
    try {
      const res = await fetch(`/api/admin/run-cron${task ? `?task=${encodeURIComponent(task)}` : ''}`,
        { method: 'POST' })
      const d = await res.json().catch(() => ({}))

      if (!res.ok || d.error) {
        toast.error(d.error || 'Could not start the automations.')
        return
      }
      toast.success(`Ran ${d.ran} task${d.ran === 1 ? '' : 's'}`)
      refetch()
    } catch {
      toast.error('Could not reach the server.')
    } finally {
      setBusy(null)
    }
  }

  /*
   * The latest run of each task.
   *
   * `task` is nullable, and indexing an object with null produced the literal
   * key "null" — a row that belonged to no task quietly became one.
   */
  const byTask: Record<string, CronRun> = {}
  for (const r of runs || []) {
    if (r.task) byTask[r.task] = r
  }
  const neverRun = Object.keys(LABELS).filter(k => !byTask[k])

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader eyebrow="System" title="Automation"
        description="Every scheduled job the system runs. One cron drives them all."
        actions={<Button onClick={() => runNow()} disabled={busy === 'all'}>{busy === 'all' ? 'Running…' : 'Run due now'}</Button>} />

      <Card className="p-4 mb-5 bg-[var(--accent-soft)] border-[var(--accent)]/15">
        <div className="text-[13px] font-semibold text-[var(--ink)] mb-1">Set up once</div>
        <p className="text-[13px] text-[var(--ink-soft)] leading-relaxed">
          At cron-job.org create a single job calling this URL every <b>5 minutes</b>:
        </p>
        {/*
          The placeholder is deliberate. This was printed with `key=1024`,
          which is not the secret — so a scheduler configured from this screen
          would have been rejected every five minutes, silently, while the page
          claimed the automations were set up. The real value is CRON_SECRET in
          the deployment environment, and it is not shown here: anyone who
          could see this screen would then be able to trigger every automation
          from outside the application.
        */}
        <code className="block mt-2 text-[12px] bg-[var(--paper)] border border-[var(--line)] rounded-lg px-3 py-2 break-all">
          https://portal.cambridge.edu.gh/api/cron/run?key=YOUR_CRON_SECRET
        </code>
        <p className="text-[12px] text-[var(--ink-faint)] mt-2 leading-relaxed">
          Replace <code className="font-mono">YOUR_CRON_SECRET</code> with the
          CRON_SECRET value from the deployment settings. The button above does
          not need it — it runs the tasks through your signed-in session.
        </p>
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
                    <div className="text-[12px] text-[var(--ink-soft)] mt-1">{l.desc}</div>
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
        <p className="text-[12px] text-[var(--ink-faint)] mt-4">
          Tasks showing “Not yet run” simply have not fired since the scheduler was set up.
        </p>
      )}
    </div>
  )
}

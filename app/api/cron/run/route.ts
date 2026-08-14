import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * ONE cron drives every automation. Point cron-job.org at
 *   /api/cron/run?key=SECRET   every 5 minutes
 * and each task fires on its own interval. Beats juggling twelve jobs, and
 * cron_runs records when each last ran so failures are visible.
 */
const TASKS: { name: string; path: string; everyMins: number }[] = [
  { name: 'lead_notify',        path: '/api/leads/notify-pending',    everyMins: 5 },
  { name: 'lead_followup',      path: '/api/leads/followup',          everyMins: 10 },
  { name: 'sequences',          path: '/api/sequences/run',           everyMins: 15 },
  { name: 'class_start',        path: '/api/classes/start-reminders', everyMins: 10 },
  { name: 'info_sessions',      path: '/api/info-sessions/run',       everyMins: 15 },
  { name: 'info_followup',      path: '/api/info-sessions/followup',  everyMins: 30 },
  { name: 'class_reminders',    path: '/api/class-reminders/run',     everyMins: 15 },
  { name: 'paystack_reconcile', path: '/api/paystack/reconcile',      everyMins: 60 },
  { name: 'prep_reminders',     path: '/api/prep/reminders',          everyMins: 720 },
  { name: 'payment_reminders',  path: '/api/payment-reminders/run',   everyMins: 1440 },
  { name: 'reports',            path: '/api/reports/generate',        everyMins: 1440 },
  { name: 'tiers',              path: '/api/tiers/recalc',            everyMins: 10080 },
]

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  if (url.searchParams.get('key') !== CONFIG.setupSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const only = url.searchParams.get('task')   // optional: run one task now
  const sb = createServiceClient()
  const origin = url.origin
  const now = Date.now()

  const { data: rows } = await sb.from('cron_runs').select('task, last_run_at, runs')
  const lastRun: Record<string, number> = {}
  for (const r of rows || []) lastRun[r.task] = r.last_run_at ? new Date(r.last_run_at).getTime() : 0

  const results: any[] = []
  for (const t of TASKS) {
    if (only && only !== t.name) continue
    const due = only ? true : (now - (lastRun[t.name] || 0)) >= t.everyMins * 60000
    if (!due) continue

    let status = 'ok', detail = ''
    try {
      const r = await fetch(`${origin}${t.path}?key=${encodeURIComponent(CONFIG.setupSecret)}`, {
        signal: AbortSignal.timeout(60000),
      })
      const body = await r.text()
      status = r.ok ? 'ok' : 'failed'
      detail = body.slice(0, 300)
    } catch (e: any) {
      status = 'failed'; detail = e?.message || 'error'
    }

    await sb.from('cron_runs').upsert({
      task: t.name, last_run_at: new Date().toISOString(),
      last_status: status, last_detail: detail,
      runs: ((rows || []).find((r: any) => r.task === t.name)?.runs || 0) + 1,
    }, { onConflict: 'task' }).then(() => {}, () => {})

    results.push({ task: t.name, status, detail: detail.slice(0, 120) })
  }

  return NextResponse.json({ ran: results.length, results })
}

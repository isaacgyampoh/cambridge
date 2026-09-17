import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { SECRETS } from '@/lib/config.server'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * ONE cron drives every automation. Point cron-job.org at
 *   /api/cron/run?key=SECRET   every 5 minutes
 * and each task fires on its own interval. Beats juggling twelve jobs, and
 * cron_runs records when each last ran so failures are visible.
 */
const TASKS: { name: string; path: string; everyMins: number }[] = [
  // Runs first and most often: everything else queues messages, and this is
  // what actually gets a failed one delivered.
  { name: 'sms_queue',          path: '/api/sms/queue',               everyMins: 5 },
  // Greets imported leads. Ten at a time, since each is two WhatsApp round
  // trips and an AI call — the work that used to sit inside the import request.
  /*
   * Kept although nothing increments its counter any more: a marketer is now
   * told the moment a lead is assigned, and an imported batch announces
   * itself at the end of the import.
   *
   * It stays because lead_assign_pending can still hold rows from leads
   * assigned BEFORE that change, and removing the only thing that drains them
   * would mean those marketers are never told at all. With an empty table it
   * reads nothing and does nothing.
   */
  { name: 'lead_notify',        path: '/api/leads/notify-pending',    everyMins: 5 },
  { name: 'lead_onboarding',    path: '/api/leads/onboarding',        everyMins: 5 },
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
  // Nightly. Keeps webhook_inbox and the message logs from growing without
  // limit; audit_logs is never pruned.
  { name: 'prune_logs',         path: '/api/maintenance/prune',       everyMins: 1440 },
]

/*
 * ── NOTHING WAS CALLING THIS ─────────────────────────────────────────────────
 *
 * Leads arrived and no SMS ever did. The pipeline was sound end to end —
 * intakeLead queues, queueSMS writes an sms_logs row with status 'queued',
 * /api/sms/queue claims a batch and sends through the Arkesel transport, and
 * ARKESEL_API_KEY and CRON_SECRET are both configured in production.
 *
 * The queue simply never drained, because vercel.json had no `crons` block.
 * The rows accumulated as 'queued' for ever and nothing reported a failure,
 * since nothing had failed: no attempt was ever made.
 *
 * One schedule is enough. This endpoint is a fan-out that paces each task by
 * its own everyMins against the cron_runs table, so being called every five
 * minutes runs sms_queue every five minutes and the daily jobs once a day.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` on a scheduled
 * invocation, which is exactly what isValidCronRequest reads.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  if (!isValidCronRequest(req)) {
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
      // Sent as a header rather than a query parameter: query strings are
      // recorded in access logs, so a long-lived shared secret does not belong
      // in one.
      const r = await fetch(`${origin}${t.path}`, {
        headers: { authorization: `Bearer ${SECRETS.cronSecret}` },
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

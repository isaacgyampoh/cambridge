import 'server-only'
import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { SECRETS } from '@/lib/config.server'
import { publicUrl } from '@/lib/url'

/**
 * RUN THE DUE JOBS OFF THE BACK OF ORDINARY TRAFFIC.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Leads arrived and marketers were never told. The chain is:
 *
 *   autoAssignLead -> bump_lead_pending (a counter)
 *                  -> /api/leads/notify-pending reads it and sends ONE
 *                     consolidated SMS per marketer
 *
 * and that endpoint is reachable only through the /api/cron/run fan-out.
 * vercel.json had no schedule at all, so the counter went up and nothing ever
 * read it. Nothing failed, which is why nothing was reported: no attempt was
 * ever made.
 *
 * The obvious fix — a five-minute cron — is refused on this plan, which
 * allows daily schedules only. A daily one is the floor, and for "you have a
 * new lead" it is close to useless: a marketer learns about Tuesday's lead on
 * Wednesday.
 *
 * ── WHY TRAFFIC IS A REASONABLE CLOCK HERE ─────────────────────────────────
 *
 * This is a staff portal. Somebody has it open through the working day, and
 * the working day is exactly when a lead arriving matters. Hanging the check
 * off requests the portal already makes turns "every five minutes" into "a
 * few seconds after the next time anybody looks at their dashboard", which
 * for this purpose is as good and often better.
 *
 * It does NOT replace the schedule. The daily cron still runs, so the
 * overnight and weekend cases are covered when nobody is logged in.
 *
 * ── WHAT STOPS IT BEING EXPENSIVE ──────────────────────────────────────────
 *
 * The fan-out already paces every task by its own everyMins against the
 * cron_runs table, so calling it more often does not run anything more often
 * — a task that is not due is skipped. This adds one cheap read to decide
 * whether to bother at all, and then hands off to after(), so nothing is on
 * the critical path of the response.
 *
 * Consolidation is not at risk either: notify-pending only picks up marketers
 * whose most recent lead is three minutes old, so being called constantly
 * still sends one message about five leads rather than five messages.
 */

/** Don't even look more often than this. */
const CHECK_EVERY_MS = 60_000

/** In-process, so a warm instance serving a burst does one read, not fifty. */
let lastLooked = 0

export function kickDueJobs(): void {
  const now = Date.now()
  if (now - lastLooked < CHECK_EVERY_MS) return
  lastLooked = now

  /*
   * after() runs once the response has been sent, so a slow fan-out cannot
   * delay the screen that triggered it. Everything inside is best-effort by
   * construction — a failure here must never surface to whoever happened to
   * load a dashboard.
   */
  after(async () => {
    try {
      const sb = createServiceClient()

      /*
       * The fan-out's own pacing is authoritative; this is only a cheap way
       * to avoid waking it when nothing can possibly be due. sms_queue is the
       * most frequent task at five minutes, so if it ran within the last
       * five, no task is due.
       */
      const { data, error } = await sb.from('cron_runs')
        .select('last_run_at').eq('task', 'sms_queue').maybeSingle()

      if (error) return
      const last = data?.last_run_at ? new Date(data.last_run_at).getTime() : 0
      if (now - last < 5 * 60_000) return

      let secret = ''
      try { secret = SECRETS.cronSecret } catch { return }

      await fetch(publicUrl('/api/cron/run'), {
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(50_000),
      })
    } catch {
      // The daily schedule is the floor. A missed opportunistic run costs
      // nothing that the next request or the next night does not recover.
    }
  })
}

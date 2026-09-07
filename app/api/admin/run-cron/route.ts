import { NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { SECRETS } from '@/lib/config.server'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Run the automation tasks now, from the automation screen.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The screen used to call /api/cron/run?key=1024 straight from the browser.
 * CRON_SECRET is not 1024, so the button had never worked: every press was a
 * silent 401, and the screen reported "failed" without ever saying why. The
 * same page also DISPLAYED that URL for an operator to paste into
 * cron-job.org, so a scheduler set up from it would never have fired either.
 *
 * The deeper problem is that it could not have worked. A shared secret cannot
 * live in client code — shipping the real one would have handed anybody who
 * opened the page the ability to trigger every automation in the system,
 * including the ones that send SMS to real students.
 *
 * So the two proofs are separated. The browser proves WHO you are, with the
 * session cookie the rest of the product already uses. The server holds the
 * secret and speaks to the cron runner itself. The secret never leaves the
 * server, and the button works.
 */

const CRON_ROLES = ['super_admin']

export const POST = withGuard({ roles: CRON_ROLES }, async (req, { session }) => {
  const task = new URL(req.url).searchParams.get('task') || undefined

  const origin = new URL(req.url).origin
  const url = `${origin}/api/cron/run${task ? `?task=${encodeURIComponent(task)}` : ''}`

  try {
    const res = await fetch(url, {
      /*
       * The header, not a query parameter. Query strings are recorded in
       * access logs and proxy logs; a long-lived shared secret does not
       * belong in one — which is the same reason /api/cron/run itself calls
       * each task with a header.
       */
      headers: { authorization: `Bearer ${SECRETS.cronSecret}` },
      signal: AbortSignal.timeout(290_000),
    })

    const body = await res.json().catch(() => ({}))

    if (!res.ok) {
      console.error('[run-cron] cron runner refused:', res.status)
      return NextResponse.json(
        { error: 'The automation runner refused the request. Check CRON_SECRET is set.' },
        { status: 502 },
      )
    }

    await recordAudit({
      actorId: session.userId,
      action: 'automation.run_now',
      resource: 'cron_runs',
      resourceId: task || 'all',
      success: true,
      metadata: { task: task || 'all', ran: body?.ran ?? 0 },
    })

    return NextResponse.json(body)
  } catch (e) {
    // A timeout here means the tasks are still running server-side; it is not
    // a failure of the request, and saying "failed" would invite a second run.
    console.error('[run-cron] could not reach the runner:', e)
    return NextResponse.json(
      { error: 'The automations were started but did not report back in time. Check the task list in a moment.' },
      { status: 504 },
    )
  }
})

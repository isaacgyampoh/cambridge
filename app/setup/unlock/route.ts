import { NextRequest, NextResponse } from 'next/server'
import { describeSetupAuth } from '@/lib/auth/guard'
import { openProvisioningWindow } from '@/lib/auth/provisioning'
import { rateLimit, clientIp, retryMessage } from '@/lib/auth/rateLimit'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * The provisioning link, openable in a browser.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * /api/setup/open does the same work but is POST-only, so the only way to
 * reach it was a curl command. When the owner is locked out of their own
 * portal — which is the one situation this whole mechanism exists for — being
 * handed a shell command is a poor answer, and on a phone it is no answer at
 * all.
 *
 * This is the same authorisation, the same window, the same audit entry, in a
 * form that can be opened by clicking it.
 *
 * ── THE SECRET IN A QUERY STRING ───────────────────────────────────────────
 *
 * A link carries its credential in the URL. That is a real cost and it is not
 * hidden here: the value lands in this deployment's request logs and in the
 * browser's history for that one request. describeSetupAuth already accepted
 * `?key=` alongside the Authorization header and records which was used, so
 * the trade was already contemplated; this makes it deliberate rather than
 * incidental.
 *
 * Three things keep it proportionate:
 *
 *   - It redirects IMMEDIATELY to /setup, so the secret does not sit in the
 *     address bar of the page the operator then reads and may screenshot.
 *   - It opens a window; it does not provision. Nothing is reset until
 *     somebody presses the button on /setup, which is a separate, one-time,
 *     thirty-minute claim.
 *   - It is rate-limited per IP and audited exactly as the POST is.
 *
 * The header form remains available and is still better for anyone who can
 * use it. This is for the case where they cannot.
 *
 * ── AND WHY A GET CHANGES STATE ────────────────────────────────────────────
 *
 * Normally it should not. A link is the entire requirement here, and a link
 * is a GET. Opening a window is bounded, self-superseding — a new window
 * closes any earlier one — and grants nothing on its own, so a prefetch or a
 * double-click costs a log line rather than access.
 */
export async function GET(req: NextRequest) {
  const limit = await rateLimit(`setup-open:${clientIp(req)}`, 10, 60 * 60, 60 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. ${retryMessage(limit.retryAfter)}` },
      { status: 429 },
    )
  }

  const attempt = describeSetupAuth(req)
  if (!attempt.ok) {
    console.error('[setup/unlock] denied.',
      'configured:', attempt.configured, '| read from:', attempt.where,
      '| same length:', attempt.lengthMatch)
    await recordAudit({
      action: 'setup.window_denied', resource: 'setup_windows', success: false, request: req,
      metadata: { secretConfigured: attempt.configured, suppliedVia: attempt.where, via: 'link' },
    })
    /*
     * Deliberately says nothing about the secret — not whether one was
     * supplied, not whether it was the right length. Somebody who opened this
     * without authorisation learns only that it did not work.
     */
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 })
  }

  // allowReset, because the account this is used for already has a PIN
  // somebody has forgotten. Without it provisioning refuses with "already
  // fully provisioned", which is the wrong answer to the only question this
  // link is ever opened to ask.
  const result = await openProvisioningWindow(true)

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 500 })
  }

  await recordAudit({
    action: 'setup.window_opened', resource: 'setup_windows', success: true, request: req,
    metadata: { allowReset: true, expiresInSeconds: result.expiresInSeconds, via: 'link' },
  })

  /*
   * 303, so the browser follows with a GET and the secret is gone from the
   * address bar by the time /setup renders.
   */
  return NextResponse.redirect(new URL('/setup', req.url), 303)
}

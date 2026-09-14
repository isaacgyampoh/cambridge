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
     * Says nothing about the SECRET — not its length, not whether one is
     * configured. What it can safely describe is the caller's own request:
     * whether a key arrived at all, and whether it shows the fingerprints of
     * a URL having mangled it on the way.
     *
     * That distinction is the whole difference between "you have the wrong
     * value" and "your value is right but the link ate part of it", and
     * without it the two are indistinguishable — which is exactly how this
     * endpoint wasted an afternoon.
     */
    return NextResponse.json({
      error: 'Not authorised.',
      hint: unlockHint(req),
    }, { status: 401 })
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


/**
 * Why this attempt may have failed, described entirely from the caller's own
 * input. Nothing here is derived from the real secret.
 */
function unlockHint(req: NextRequest): string {
  const raw = new URL(req.url).search
  const supplied = new URL(req.url).searchParams.get('key')
    ?? new URL(req.url).searchParams.get('secret')

  if (supplied === null) {
    return 'No key was supplied. Open this link with ?key=… appended, or send the secret as an Authorization: Bearer header.'
  }
  if (!supplied.trim()) {
    return 'The key was empty.'
  }
  /*
   * A space in the received value almost always means the secret contained a
   * '+' and the browser sent it as a space. The server now tries that reading
   * too, so reaching here having seen one means the value really is wrong —
   * but it is worth naming, because it is the likeliest thing a person has
   * already half-noticed.
   */
  if (/\s/.test(supplied)) {
    return 'The key arrived containing a space, which usually means it holds a "+" that the URL converted. '
      + 'Try percent-encoding it (+ becomes %2B), or send it as an Authorization: Bearer header instead.'
  }
  if (raw.includes('%') && !/%[0-9a-fA-F]{2}/.test(raw)) {
    return 'The key contains a "%" that is not a valid escape, so part of it was lost. '
      + 'Percent-encode it (% becomes %25), or use an Authorization: Bearer header.'
  }
  return 'That key was not accepted. If it contains + & % or #, a URL will alter it — '
    + 'send it as an Authorization: Bearer header instead, which is not encoded. '
    + 'A "#" in particular is never sent to the server at all.'
}
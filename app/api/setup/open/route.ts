import { NextRequest, NextResponse } from 'next/server'
import { describeSetupAuth } from '@/lib/auth/guard'
import { openProvisioningWindow } from '@/lib/auth/provisioning'
import { rateLimit, clientIp, retryMessage } from '@/lib/auth/rateLimit'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * Open a provisioning window. Requires SETUP_SECRET.
 *
 * This is the half of setup that needs the secret, and it is deliberately the
 * half no browser performs: the secret stays in the deployment environment and
 * is presented by whoever operates it. The browser performs the other half,
 * with no secret at all.
 *
 * Nothing is provisioned here and no credential is created. All this does is
 * say "for the next half hour, the setup page may act once".
 */
export async function POST(req: NextRequest) {
  const limit = await rateLimit(`setup-open:${clientIp(req)}`, 10, 60 * 60, 60 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. ${retryMessage(limit.retryAfter)}` },
      { status: 429 }
    )
  }

  const attempt = describeSetupAuth(req)
  if (!attempt.ok) {
    // Same safe metadata as first-run: where it looked and whether the server
    // is configured. Never the secret, never anything derived from it.
    console.error('[setup/open] denied.',
      'configured:', attempt.configured, '| read from:', attempt.where,
      '| same length:', attempt.lengthMatch)
    await recordAudit({
      action: 'setup.window_denied', resource: 'setup_windows', success: false, request: req,
      metadata: { secretConfigured: attempt.configured, suppliedVia: attempt.where },
    })
    return NextResponse.json({
      error: 'Not authorised.',
      setupSecretConfigured: attempt.configured,
      suppliedVia: attempt.where,
    }, { status: 401 })
  }

  const allowReset = new URL(req.url).searchParams.get('allowReset') === 'true'
  const result = await openProvisioningWindow(allowReset)

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 500 })
  }

  await recordAudit({
    action: 'setup.window_opened', resource: 'setup_windows', success: true, request: req,
    metadata: { allowReset, expiresInSeconds: result.expiresInSeconds },
  })

  return NextResponse.json({
    success: true,
    expiresInSeconds: result.expiresInSeconds,
    allowReset,
    message: 'Setup is open. Complete it in the browser at /setup.',
  })
}

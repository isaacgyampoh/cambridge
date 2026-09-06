import { NextRequest, NextResponse } from 'next/server'
import { claimProvisioning, readProvisioningState } from '@/lib/auth/provisioning'
import { rateLimit, clientIp, retryMessage } from '@/lib/auth/rateLimit'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * Claim an open provisioning window and receive the credentials, once.
 *
 * ── WHY THIS TAKES NO SECRET ───────────────────────────────────────────────
 *
 * The authorisation happened at /api/setup/open, which does require
 * SETUP_SECRET. This endpoint is useless without an open window: with none, it
 * refuses, always. It is not a public provisioning button — it is the second
 * half of an operation somebody already authorised.
 *
 * ── WHAT COMES BACK, AND WHY ONLY ONCE ─────────────────────────────────────
 *
 * The two PINs are returned in this response and nowhere else. They are not
 * written to a log, an audit record, a URL or a cookie, and there is no
 * endpoint that can be asked for them again — the window is spent by the act
 * of claiming it. If the operator loses them, the remedy is to open another
 * window, not to retrieve these.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  // A window is minutes long and single use, but the endpoint is still public
  // in the sense that anyone can call it, so it is throttled like one.
  const limit = await rateLimit(`setup-provision:${ip}`, 8, 15 * 60, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. ${retryMessage(limit.retryAfter)}` },
      { status: 429 }
    )
  }

  const result = await claimProvisioning(ip)

  if (!result.ok) {
    await recordAudit({
      action: 'setup.provision_refused', resource: 'profiles', success: false, request: req,
      metadata: { reason: result.reason },
    })
    return NextResponse.json({ error: result.reason }, { status: result.status })
  }

  await recordAudit({
    action: result.reset ? 'setup.super_admin_reprovisioned' : 'setup.super_admin_provisioned',
    resource: 'profiles', success: true, request: req,
    // That it happened, and to which account. Never what the credentials are.
    metadata: { email: result.email, mustChangePin: true },
  })

  return NextResponse.json({
    success: true,
    signInPin: result.signInPin,
    recoveryPin: result.recoveryPin,
    email: result.email,
    reset: result.reset,
  })
}

/** What the setup page should show. No secret, no credential — server facts. */
export async function GET() {
  return NextResponse.json(await readProvisioningState())
}

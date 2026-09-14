import 'server-only'
import { timingSafeEqual } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { rateLimit, clientIp } from '@/lib/auth/rateLimit'

/**
 * WHO IS ALLOWED TO PUT A LEAD INTO THIS SYSTEM.
 *
 * ── WHAT AN OPEN LEAD WEBHOOK ACTUALLY COSTS ───────────────────────────────
 *
 * These endpoints are not read-only, and they do not stop at writing a row.
 * Posting one lands in intakeLead, which creates the lead, hands it to
 * autoAssignLead, and that calls onLeadAssigned — which sends the welcome
 * pack and the opening WhatsApp message to `lead.phone`.
 *
 * `lead.phone` is whatever the caller put in the body.
 *
 * So an unauthenticated endpoint that anyone on the internet can post to is a
 * way of making the centre send WhatsApp and SMS messages to any number a
 * stranger chooses, as often as they like, billed to the centre — while
 * filling the marketers' queues with people who do not exist.
 *
 * Three of these were reachable that way. /website and /linkedin had no check
 * of any kind. /google looked as though it had one:
 *
 *     if (SECRETS.googleLeadKey && body.google_key && body.google_key !== SECRETS.googleLeadKey)
 *
 * — which only rejects a WRONG key. Omit `google_key` entirely and the middle
 * condition is false, so the whole test is skipped. The way past the lock was
 * to not touch it.
 *
 * ── WHY THE SECRET IS OPTIONAL AND THE THROTTLE IS NOT ─────────────────────
 *
 * Requiring a secret that nobody has configured yet would stop real enquiries
 * arriving from the live website, which is a worse outcome than the abuse it
 * prevents. So the secret is enforced the moment one exists, and until then
 * the throttle is what stands there — it needs no configuration, and a
 * message pump is exactly the shape of traffic it refuses.
 *
 * Both together is the intended end state; either alone is still a guard.
 */

/** How the caller may present the shared secret. */
const KEY_HEADER = 'x-cce-webhook-key'

function sameSecret(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, which is itself a leak of
  // length — compare lengths first and always run the constant-time check.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export type LeadWebhookGuard =
  | { ok: true }
  | { ok: false; response: NextResponse }

/**
 * Decide whether this inbound lead may proceed.
 *
 * @param source  Which webhook, for the throttle key and the logs.
 * @param secret  The configured shared secret, or undefined when there is none.
 * @param bodyKey A key carried in the body, for providers that cannot set a
 *                header (Google Forms sends `google_key` as a field).
 */
export async function guardLeadWebhook(opts: {
  req: NextRequest
  source: string
  secret?: string | null
  bodyKey?: unknown
}): Promise<LeadWebhookGuard> {
  const { req, source, secret, bodyKey } = opts

  /*
   * The secret, when there is one. Note the shape: presence of a CONFIGURED
   * secret is what makes the check mandatory — never the presence of a
   * supplied one, which is the mistake that made /google bypassable.
   */
  if (secret) {
    const supplied = req.headers.get(KEY_HEADER) || (typeof bodyKey === 'string' ? bodyKey : '')
    if (!supplied || !sameSecret(supplied, secret)) {
      console.warn(`[webhooks/${source}] rejected: ${supplied ? 'wrong' : 'missing'} key`)
      return {
        ok: false,
        response: NextResponse.json({ error: 'Not authorised.' }, { status: 401 }),
      }
    }
  }

  /*
   * The throttle runs for authenticated callers too. A leaked key is still a
   * pump, and a real provider never needs this many in an hour from one
   * address.
   */
  const ip = clientIp(req)
  const limit = await rateLimit(`lead_webhook:${source}:${ip}`, 20, 3600, 3600)
  if (!limit.allowed) {
    console.warn(`[webhooks/${source}] throttled ${ip} — ${limit.retryAfter}s`)
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Too many submissions. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter || 3600) } },
      ),
    }
  }

  return { ok: true }
}

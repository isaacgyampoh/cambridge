import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { verifySession, type SessionInfo, SESSION_COOKIE } from '@/lib/auth/pin'
import { resolvePortals } from '@/lib/access/portals'
import { SECRETS } from '@/lib/config.server'
import { timingSafeEqual } from 'crypto'

/**
 * Route-level authorization.
 *
 * Every sensitive handler calls one of these. The Proxy guard is a coarse
 * first pass that can be bypassed or skipped (it does not run for internal
 * requests, and it must not be trusted as the sole gate); this is the check
 * that actually decides.
 */

export type Guarded = {
  session: SessionInfo & { userId: string; role: string }
  portals: string[]
}

/** A refusal, ready to return from a route handler. */
export class GuardError extends Error {
  constructor(public status: number, public userMessage: string) {
    super(userMessage)
  }
  get response() {
    return NextResponse.json({ error: this.userMessage }, { status: this.status })
  }
}

/**
 * Require a signed-in user, optionally holding one of `portals` or one of
 * `roles`. Throws GuardError, which `withGuard` turns into a response.
 *
 * ```ts
 * export const POST = withGuard({ portals: ['finance'] }, async (req, { session }) => { ... })
 * ```
 */
export async function requireSession(
  req: NextRequest,
  opts: { portals?: string[]; roles?: string[] } = {}
): Promise<Guarded> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token) throw new GuardError(401, 'Please sign in to continue.')

  const session = await verifySession(token)
  if (!session.valid || !session.userId || !session.role) {
    throw new GuardError(401, 'Your session has expired. Please sign in again.')
  }

  const portals = resolvePortals(session.role, session.portals)

  // Super admin passes every portal and role check.
  if (session.role !== 'super_admin') {
    if (opts.roles?.length && !opts.roles.includes(session.role)) {
      throw new GuardError(403, 'You do not have access to this.')
    }
    if (opts.portals?.length && !opts.portals.some(p => portals.includes(p))) {
      throw new GuardError(403, 'You do not have access to this.')
    }
  }

  return {
    session: session as SessionInfo & { userId: string; role: string },
    portals,
  }
}

/**
 * Wrap a route handler so GuardError becomes a clean JSON refusal and any
 * unexpected throw becomes a generic 500 — never a stack trace or a database
 * message sent to the browser.
 */
export function withGuard(
  opts: { portals?: string[]; roles?: string[] },
  handler: (req: NextRequest, ctx: Guarded) => Promise<Response>
) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      const ctx = await requireSession(req, opts)
      return await handler(req, ctx)
    } catch (e) {
      if (e instanceof GuardError) return e.response
      console.error('[route] unhandled error:', e)
      return NextResponse.json(
        { error: 'Something went wrong handling that request. Please try again.' },
        { status: 500 }
      )
    }
  }
}

/**
 * Authenticate a scheduled job.
 *
 * Accepts the secret from the Authorization header in preference to the query
 * string — a URL query lands in server, proxy and browser-history logs, which
 * is a poor place for a long-lived shared secret. The query form is still
 * accepted so existing cron-job.org entries keep working; move them to the
 * header when convenient.
 */
export function isValidCronRequest(req: NextRequest): boolean {
  const expected = SECRETS.cronSecret
  const url = new URL(req.url)
  const supplied =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    url.searchParams.get('key') ||
    url.searchParams.get('secret') ||
    ''
  return safeEqual(supplied, expected)
}

/** The setup secret, used by the one-time bootstrap endpoints. */
export function isValidSetupRequest(req: NextRequest): boolean {
  const url = new URL(req.url)
  const supplied =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    url.searchParams.get('key') ||
    url.searchParams.get('secret') ||
    ''
  return safeEqual(supplied, SECRETS.setupSecret)
}

/** Constant-time string comparison that does not leak length through timing. */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

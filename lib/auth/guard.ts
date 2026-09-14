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

  /*
   * A session that could not be CHECKED is not an expired one.
   *
   * 401 is what the client treats as "sign in again", so answering it here
   * during a database blip logs a member of staff out of a screen they are
   * working in and sends them back to the PIN box for a fault that was never
   * theirs. 503 says what is true: try again in a moment.
   */
  if (session.failed) {
    throw new GuardError(503, 'We could not verify your session just now. Please try again in a moment.')
  }

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
  return describeSetupAuth(req).ok
}

/** Where the caller put the secret. Useful for diagnosis; reveals no value. */
export type SetupAuthAttempt = {
  ok: boolean
  /** Which location the secret was read from, or 'none' if it was absent. */
  where: 'header' | 'query:key' | 'query:secret' | 'none'
  /** Whether SETUP_SECRET is configured in this environment at all. */
  configured: boolean
  /**
   * Whether the two values were the same LENGTH. One bit, and the decisive
   * one when diagnosing a paste problem: a trailing newline or a '+' turned
   * into a space changes the length, a genuinely wrong secret usually does
   * not. The values themselves are never returned or logged.
   */
  lengthMatch: boolean
}

/**
 * Check a setup/provisioning request, and say enough about the attempt to
 * diagnose a failure without disclosing anything.
 *
 * ── WHY THE HEADER IS PREFERRED ────────────────────────────────────────────
 *
 * A secret in a query string is URL-decoded before the server sees it, and
 * three characters that appear routinely in generated secrets do not survive
 * the trip:
 *
 *     +   becomes a space
 *     &   truncates the parameter
 *     %   is read as the start of an escape and mangles what follows
 *
 * A base64 secret containing '+' therefore fails every time, with no
 * indication of why. Sending it as `Authorization: Bearer …` avoids the
 * encoding entirely, so that is checked first.
 *
 * Both sides are trimmed. Whitespace is never meaningful in a secret, and a
 * trailing newline is the commonest artefact of copying a value out of a
 * terminal or a file.
 */
export function describeSetupAuth(req: NextRequest): SetupAuthAttempt {
  const url = new URL(req.url)

  const header = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const fromKey = url.searchParams.get('key')
  const fromSecret = url.searchParams.get('secret')

  const where: SetupAuthAttempt['where'] =
    header ? 'header' : fromKey ? 'query:key' : fromSecret ? 'query:secret' : 'none'

  const supplied = (header || fromKey || fromSecret || '').trim()

  let expected = ''
  try {
    expected = SECRETS.setupSecret.trim()
  } catch {
    // Not configured in this environment. Reported, never guessed around.
    return { ok: false, where, configured: false, lengthMatch: false }
  }

  return {
    ok: safeEqual(supplied, expected),
    where,
    configured: true,
    lengthMatch: supplied.length === expected.length,
  }
}

/** Constant-time string comparison that does not leak length through timing. */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

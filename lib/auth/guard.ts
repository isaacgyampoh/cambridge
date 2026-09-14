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
  const rawQuery = url.search.startsWith('?') ? url.search.slice(1) : url.search

  const fromKey = url.searchParams.get('key')
  const fromSecret = url.searchParams.get('secret')

  const where: SetupAuthAttempt['where'] =
    header ? 'header' : fromKey !== null ? 'query:key' : fromSecret !== null ? 'query:secret' : 'none'

  /*
   * ── READING A SECRET OUT OF A QUERY STRING ───────────────────────────────
   *
   * The note above says a '+', '&' or '%' in a secret does not survive the
   * trip. That was written as a reason to PREFER the header — and then
   * /setup/unlock was built specifically for browser ?key= delivery, because
   * somebody locked out of their own portal cannot send a header from a
   * phone. It inherited the flaw, and the symptom is the one the note
   * predicted: "Not authorised" every time, with no indication why.
   *
   * So rather than one reading of the query, every plausible reading is
   * tried:
   *
   *   - what URLSearchParams says      (correct when the secret was encoded)
   *   - the raw value, '+' preserved   (correct when it was pasted verbatim)
   *   - the raw value to the END of the query string, so an '&' inside the
   *     secret is not read as the start of another parameter
   *
   * This does NOT loosen anything. Each candidate is compared, in constant
   * time, against the real secret; a value that is not the secret matches
   * none of them. What it removes is a way for the CORRECT secret to be
   * rejected because of how a browser packed it.
   *
   * '#' is the one that cannot be repaired here: a browser treats it as the
   * start of a fragment and never sends what follows, so the server cannot
   * see it to begin with. That case is named in the hint below.
   */
  const candidates = header
    ? [header]
    : [
        fromKey ?? '',
        fromSecret ?? '',
        ...rawCandidates(rawQuery, 'key'),
        ...rawCandidates(rawQuery, 'secret'),
      ]

  let expected = ''
  try {
    expected = SECRETS.setupSecret.trim()
  } catch {
    // Not configured in this environment. Reported, never guessed around.
    return { ok: false, where, configured: false, lengthMatch: false }
  }

  let ok = false
  let bestLengthMatch = false
  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    if (!trimmed) continue
    // Every candidate is checked even once one has matched, so the work done
    // does not depend on WHICH reading was the right one.
    if (safeEqual(trimmed, expected)) ok = true
    if (trimmed.length === expected.length) bestLengthMatch = true
  }

  return { ok, where, configured: true, lengthMatch: bestLengthMatch }
}

/**
 * Readings of one query parameter that URLSearchParams does not give you.
 *
 * Returns the raw slice with '+' left alone, and the slice running to the end
 * of the query string so an '&' inside the value is not treated as a
 * separator. Percent escapes are decoded where they decode cleanly; a value
 * containing a bare '%' is also offered undecoded, because that is what a
 * verbatim paste actually contains.
 */
function rawCandidates(rawQuery: string, param: string): string[] {
  const marker = `${param}=`
  const at = rawQuery.startsWith(marker)
    ? 0
    : rawQuery.indexOf(`&${marker}`) >= 0
      ? rawQuery.indexOf(`&${marker}`) + 1
      : -1
  if (at < 0) return []

  const afterName = rawQuery.slice(at + marker.length)
  const upToNextParam = afterName.split('&')[0]

  const out = new Set<string>([afterName, upToNextParam])
  for (const value of [afterName, upToNextParam]) {
    try {
      out.add(decodeURIComponent(value))
    } catch {
      // A bare '%' makes this throw. The undecoded form is already included.
    }
  }
  return [...out]
}

/** Constant-time string comparison that does not leak length through timing. */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

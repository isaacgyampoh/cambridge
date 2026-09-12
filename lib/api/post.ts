/**
 * POST or PATCH a JSON body to one of this application's own routes, and
 * throw if it was refused.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `mutate()` in hooks/useData already does this for /api/data: it reads
 * res.ok and throws with the server's message, so any caller inside a
 * try/catch reports the truth. Every other endpoint was called with a
 * hand-rolled fetch, and a hand-rolled fetch does not throw — a 400, a 403 or
 * a 500 comes back as a perfectly ordinary resolved promise.
 *
 * So screens did this:
 *
 *     await fetch('/api/classes/zoom', { method: 'POST', ... })
 *     toast.success('Zoom link saved')
 *
 * and announced success whatever happened. The audit found the same three
 * lines on a dozen screens: saving a Zoom link, deleting a flyer, cancelling
 * an info session, enrolling a student, sending an alert.
 *
 * The fix is not a rule for people to remember. It is a function that makes
 * the wrong thing hard to write: this throws, so the try/catch that is
 * already wrapped around most of these call sites starts working.
 *
 * ── WHAT IT THROWS ─────────────────────────────────────────────────────────
 *
 * An Error carrying the server's own message where there is one, because
 * these routes write theirs for the operator — "That person cannot receive
 * leads", "This lead belongs to someone else" — and a generic apology in
 * their place is a downgrade. Where there is nothing usable, the message says
 * what failed rather than "Failed".
 */

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type PostOptions = {
  method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** What to say if the server sends nothing usable back. */
  fallback?: string
}

export async function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  { method = 'POST', fallback = 'That could not be saved. Please try again.' }: PostOptions = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // Offline, or the request never landed. Not a refusal, and worth saying so.
    throw new ApiError(0, 'We could not reach the server. Check your connection and try again.')
  }

  const json = await res.json().catch(() => null)

  /*
   * A route may answer 200 with { error } — several here do, because they
   * return a partial result alongside a problem. The body decides, not the
   * status alone.
   */
  if (!res.ok || (json && typeof json === 'object' && 'error' in json && json.error)) {
    const message = json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string'
      ? (json as { error: string }).error
      : fallback
    throw new ApiError(res.status, message)
  }

  return (json ?? {}) as T
}

/** The message to show a person for any error this module may throw. */
export function messageFor(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return e instanceof ApiError || e instanceof Error ? e.message || fallback : fallback
}

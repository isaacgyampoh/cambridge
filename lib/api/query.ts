/**
 * Read rows from /api/data.
 *
 * ── WHY THIS IS ONE FUNCTION AND NOT FIVE ──────────────────────────────────
 *
 * Five pages carried their own copy — the admin, PM and finance reports, the
 * marketer performance board and the PM lead detail. Four were identical but
 * for a default limit; the fifth had grown ordering the others never got. The
 * bug below therefore had to be found five times to be fixed once.
 *
 * ── THE BUG THEY ALL SHARED ────────────────────────────────────────────────
 *
 *     const json = await res.json()
 *     return json.data || []
 *
 * Nothing looked at `res.ok`. /api/data answers a failure with { error } and
 * no `data` — 401 when the session has expired, 403 when the role does not
 * reach the table, 500 when the query fails. Every one of those came back
 * from this function as an empty array, indistinguishable from a table that
 * genuinely has no rows.
 *
 * So an expired session did not send anyone to the sign-in screen. It drew
 * the finance report with every total at zero, the marketer board with nobody
 * on it, and the admin report showing no leads this month — confidently, with
 * no error anywhere on the page. Those are numbers an operator acts on. A
 * report that says the month brought in nothing is worse than a report that
 * fails to load, because only one of them is obviously wrong.
 *
 * It throws now. The callers catch it and show what happened.
 */

export class ApiQueryError extends Error {
  readonly status: number
  readonly table: string

  constructor(table: string, status: number, message: string) {
    super(message)
    this.name = 'ApiQueryError'
    this.status = status
    this.table = table
  }

  /** What to put on the screen. Distinguishes the cases an operator can act on. */
  get userMessage(): string {
    if (this.status === 401) return 'Your session has expired. Sign in again to see this.'
    if (this.status === 403) return 'You do not have access to this information.'
    return this.message || 'This could not be loaded. Please try again.'
  }
}

export type QueryFilter = { col: string; op: string; val: string | number | boolean | null }

export type QueryOptions = {
  filters?: QueryFilter[]
  orderBy?: string
  orderAsc?: boolean
  limit?: number
}

/**
 * The generic is a claim about the table, not a check on it — nothing here
 * validates the rows against T. It is the same claim the call sites were
 * making implicitly by reading fields off `any`, written down where a reader
 * can see it and the compiler can hold the rest of the page to it.
 */
export async function apiQuery<T = Record<string, unknown>>(
  table: string,
  select: string,
  { filters, orderBy, orderAsc, limit = 2000 }: QueryOptions = {},
): Promise<T[]> {
  const params = new URLSearchParams({ table, select, limit: String(limit) })
  if (filters?.length) params.set('filters', JSON.stringify(filters))
  if (orderBy) {
    params.set('orderBy', orderBy)
    if (orderAsc !== undefined) params.set('orderAsc', String(orderAsc))
  }

  let res: Response
  try {
    res = await fetch(`/api/data?${params}`)
  } catch {
    // Offline, or the request never landed. Not an empty table.
    throw new ApiQueryError(table, 0, 'Could not reach the server. Check your connection.')
  }

  const json = await res.json().catch(() => null)

  if (!res.ok || !json || json.error) {
    throw new ApiQueryError(table, res.status, json?.error || 'Could not load that information.')
  }

  return (json.data as T[]) || []
}

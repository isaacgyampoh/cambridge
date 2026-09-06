'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'

/** A value a filter can be compared against — whatever PostgREST accepts. */
type FilterValue = string | number | boolean | null | Array<string | number>

export type DataFilter = { col: string; op: string; val: FilterValue }

interface UseDataOptions {
  table: string
  select?: string
  limit?: number
  orderBy?: string
  orderAsc?: boolean
  filters?: DataFilter[]
  enabled?: boolean
}

interface UseDataResult<T> {
  data: T[]
  loading: boolean
  error: string | null
  /**
   * The three outcomes as one value, so it can be handed straight to DataTable
   * or ErrorState without each page re-deriving it from `loading` and `error`.
   */
  state: 'loading' | 'ready' | 'error'
  refetch: () => void
}

/*
 * `T` defaults to a permissive row because most callers pass a concrete type
 * and the ones that do not are reading loosely-shaped joins. Narrowing the
 * default would not make those safer, only noisier.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useData<T = any>(opts: UseDataOptions): UseDataResult<T> {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /*
   * Every option that changes the request, as one memoised string.
   *
   * ── TWO BUGS THIS FIXES ────────────────────────────────────────────────
   *
   * The dependency list was written out by hand and `orderAsc` was missing
   * from it, so a screen that flipped its sort direction kept the previous
   * result — the arrow moved and the rows did not.
   *
   * It also called JSON.stringify(opts.filters) inside the dependency array
   * itself, which runs on every render whether or not anything changed.
   * Building the key once, here, means the request identity changes when and
   * only when the request does.
   */
  const key = useMemo(
    () => JSON.stringify([
      opts.table, opts.select, opts.limit,
      opts.orderBy, opts.orderAsc, opts.filters, opts.enabled,
    ]),
    [opts.table, opts.select, opts.limit, opts.orderBy, opts.orderAsc, opts.filters, opts.enabled]
  )

  /** What one attempt produced. Nothing here touches state. */
  type Outcome =
    | { ok: true; rows: T[] }
    | { ok: false; message: string }
    | { ok: 'skipped' }

  /*
   * The request, and nothing else.
   *
   * State used to be set from inside this and it was called straight from the
   * effect, which React 19 counts as a cascading render: a second render pass
   * before the first has painted, on every mount of every screen using this
   * hook. Returning the outcome instead lets the effect apply it once.
   */
  const request = useCallback(async (): Promise<Outcome> => {
    const [table, select, limit, orderBy, orderAsc, filters, enabled] =
      JSON.parse(key) as [string, string?, number?, string?, boolean?, UseDataOptions['filters']?, boolean?]

    if (enabled === false) return { ok: 'skipped' }

    try {
      const params = new URLSearchParams({
        table,
        select: select || '*',
        limit: String(limit || 200),
        ...(orderBy ? { orderBy } : {}),
        ...(orderAsc !== undefined ? { orderAsc: String(orderAsc) } : {}),
        ...(filters?.length ? { filters: JSON.stringify(filters) } : {}),
      })
      const res = await window.fetch(`/api/data?${params}`)
      const json = await res.json().catch(() => ({}))

      if (res.ok) return { ok: true, rows: (json.data || []) as T[] }

      /*
       * Say something, always.
       *
       * Thirty-seven screens call this hook and not one of them read the
       * `error` it returns, so a failed load left a blank panel and no
       * explanation — indistinguishable from "there is nothing here". A
       * permissions refusal in particular looked exactly like an empty list.
       */
      return {
        ok: false,
        message: res.status === 403
          ? 'You do not have access to this information.'
          : res.status === 401
            ? 'Your session has expired. Please sign in again.'
            : json.error || 'That did not load. Please try again.',
      }
    } catch {
      return { ok: false, message: 'Could not reach the server. Check your connection.' }
    }
  }, [key])

  /*
   * Apply an outcome.
   *
   * The toast is the floor, not the ceiling: a screen that renders `state`
   * gets a proper error panel with a retry as well.
   */
  const apply = useCallback((outcome: Outcome) => {
    if (outcome.ok === 'skipped') { setLoading(false); return }

    if (outcome.ok) {
      setData(outcome.rows)
      setError(null)
    } else {
      setError(outcome.message)
      setData([])
      toast.error(outcome.message, { id: `useData:${opts.table}` })
    }
    setLoading(false)
  }, [opts.table])

  /** Ask again — a person pressing retry, or a screen after a write. */
  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    apply(await request())
  }, [apply, request])

  useEffect(() => {
    // `alive` stops a slow response from a previous key overwriting a newer
    // one — switching filters quickly used to be able to land out of order.
    let alive = true
    request().then(outcome => { if (alive) apply(outcome) })
    return () => { alive = false }
  }, [request, apply])

  const state: 'loading' | 'ready' | 'error' =
    loading ? 'loading' : error ? 'error' : 'ready'

  return { data, loading, error, state, refetch }
}

// Mutation helper
export async function mutate(
  method: 'POST' | 'PATCH',
  table: string,
  // One row, or many: the insert path is used for bulk writes too, such as
  // recording a whole class's attendance in a single request.
  data: Record<string, unknown> | Record<string, unknown>[],
  filters?: { col: string; val: FilterValue }[],
  opts?: { upsert?: boolean; onConflict?: string }
) {
  const res = await fetch('/api/data', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, data, filters, ...opts }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed')
  return json.data
}

export async function mutateDelete(table: string, filters: { col: string; val: FilterValue }[]) {
  const res = await fetch('/api/data', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, filters }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed')
  return json
}

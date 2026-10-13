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

/**
 * Columns the SERVER owns, dropped from an update before it is sent.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 *
 * An edit form loads a row, copies it into state, and sends it back. The row
 * it loaded carries created_at, so the update carried created_at, and
 * /api/data refuses any write naming a globally unwritable column — the whole
 * request, not just that field. The operator saw "The field created_at cannot
 * be changed here" and the edit did not save.
 *
 * It made editing a course impossible. Isaac could type the corrected fee,
 * press Save, and the price on the card never changed — which is why the
 * portal went on showing an old fee no matter what was fixed elsewhere. The
 * Knowledge and WhatsApp-line forms had the same shape.
 *
 * Carrying these back is not an attempt to change them; it is a form
 * round-tripping what it was given. So they are dropped here, once, rather
 * than every form remembering to omit them.
 *
 * ── WHAT IS DELIBERATELY NOT DROPPED ───────────────────────────────────────
 *
 * Only these two. The rest of GLOBALLY_UNWRITABLE — pin_hash, session_token,
 * wasender_api_key, the recovery credentials — must go on being REFUSED, and
 * loudly: nothing round-trips those by accident, so a request naming one is
 * either a bug worth seeing or an attempt worth blocking. Silently dropping
 * them would hide both.
 */
const SERVER_MANAGED = ['created_at', 'updated_at']

function withoutServerManaged<T>(data: T): T {
  if (Array.isArray(data)) return data.map(withoutServerManaged) as T
  if (!data || typeof data !== 'object') return data
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (!SERVER_MANAGED.includes(k)) out[k] = v
  }
  return out as T
}

// Mutation helper
export async function mutate(
  method: 'POST' | 'PATCH',
  table: string,
  // One row, or many: the insert path is used for bulk writes too, such as
  // recording a whole class's attendance in a single request.
  data: Record<string, unknown> | Record<string, unknown>[],
  // `op` defaults to 'eq'; 'in' names a specific list of rows in one request.
  filters?: { col: string; op?: 'eq' | 'in'; val: FilterValue | FilterValue[] }[],
  opts?: { upsert?: boolean; onConflict?: string }
) {
  /*
   * Only on PATCH. An insert that names created_at is a caller stating a
   * value on purpose, and should still be refused rather than quietly
   * ignored; an update that names it is a form handing back what it loaded.
   */
  const payload = method === 'PATCH' ? withoutServerManaged(data) : data

  const res = await fetch('/api/data', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, data: payload, filters, ...opts }),
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

'use client'
import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'

interface UseDataOptions {
  table: string
  select?: string
  limit?: number
  orderBy?: string
  orderAsc?: boolean
  filters?: { col: string; op: string; val: any }[]
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

export function useData<T = any>(opts: UseDataOptions): UseDataResult<T> {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    if (opts.enabled === false) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        table: opts.table,
        select: opts.select || '*',
        limit: String(opts.limit || 200),
        ...(opts.orderBy ? { orderBy: opts.orderBy } : {}),
        ...(opts.orderAsc !== undefined ? { orderAsc: String(opts.orderAsc) } : {}),
        ...(opts.filters?.length ? { filters: JSON.stringify(opts.filters) } : {}),
      })
      const res = await window.fetch(`/api/data?${params}`)
      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        /*
         * Say something, always.
         *
         * Thirty-seven screens call this hook and not one of them read the
         * `error` it returns, so a failed load left a blank panel and no
         * explanation — indistinguishable from "there is nothing here". A
         * permissions refusal in particular looked exactly like an empty list.
         *
         * The toast is the floor, not the ceiling: a screen that renders
         * `state` gets a proper error panel with a retry as well.
         */
        const message = res.status === 403
          ? 'You do not have access to this information.'
          : res.status === 401
            ? 'Your session has expired. Please sign in again.'
            : json.error || 'That did not load. Please try again.'

        setError(message)
        setData([])
        toast.error(message, { id: `useData:${opts.table}` })
      } else {
        setData(json.data || [])
      }
    } catch (e) {
      const message = 'Could not reach the server. Check your connection.'
      setError(message)
      setData([])
      toast.error(message, { id: `useData:${opts.table}` })
    } finally {
      setLoading(false)
    }
  }, [opts.table, opts.select, opts.limit, opts.orderBy, JSON.stringify(opts.filters), opts.enabled])

  useEffect(() => { fetch_() }, [fetch_])

  const state: 'loading' | 'ready' | 'error' =
    loading ? 'loading' : error ? 'error' : 'ready'

  return { data, loading, error, state, refetch: fetch_ }
}

// Mutation helper
export async function mutate(
  method: 'POST' | 'PATCH',
  table: string,
  data: any,
  filters?: { col: string; val: any }[],
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

export async function mutateDelete(table: string, filters: { col: string; val: any }[]) {
  const res = await fetch('/api/data', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, filters }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed')
  return json
}

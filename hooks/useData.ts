'use client'
import { useState, useEffect, useCallback } from 'react'

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
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Failed'); setData([]) }
      else setData(json.data || [])
    } catch (e: any) {
      setError(e.message)
      setData([])
    } finally {
      setLoading(false)
    }
  }, [opts.table, opts.select, opts.limit, opts.orderBy, JSON.stringify(opts.filters), opts.enabled])

  useEffect(() => { fetch_() }, [fetch_])

  return { data, loading, error, refetch: fetch_ }
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

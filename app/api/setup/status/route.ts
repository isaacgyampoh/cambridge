import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Whether this deployment is wired up: schema present, super admin created,
 * session table reachable.
 *
 * The three probes are INDEPENDENT and were awaited one after another, so the
 * endpoint paid three sequential round trips to the database for three
 * questions that have nothing to do with each other. Measured at an average of
 * 1.46 s before this and the region change.
 *
 * Promise.all makes it one round trip's worth of waiting. Each probe still
 * fails independently — a missing table answers "no" for that line rather than
 * taking the whole response down.
 */
export async function GET() {
  const sb = createServiceClient()

  const probe = async (run: () => Promise<unknown>): Promise<boolean> => {
    try {
      await run()
      return true
    } catch {
      return false
    }
  }

  const [schema, admin, sessions] = await Promise.all([
    probe(async () => {
      const { error } = await sb.from('profiles').select('id').limit(1)
      if (error) throw error
    }),
    (async () => {
      try {
        const { data, error } = await sb.from('profiles')
          .select('id').eq('role', 'super_admin').limit(1)
        if (error) throw error
        return (data?.length || 0) > 0
      } catch {
        return false
      }
    })(),
    probe(async () => {
      const { error } = await sb.from('pin_sessions').select('id').limit(1)
      if (error) throw error
    }),
  ])

  return NextResponse.json({ schema, admin, sessions })
}

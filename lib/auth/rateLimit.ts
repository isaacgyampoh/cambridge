import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import type { NextRequest } from 'next/server'

/**
 * Rate limiting, backed by Postgres.
 *
 * The app runs on Vercel's serverless platform, where each request may be
 * handled by a different instance, so an in-process counter (a Map, say) would
 * count only a fraction of the traffic and reset constantly. The Next.js Proxy
 * docs make the same point: proxy code "should not attempt relying on shared
 * modules or globals". Postgres is the only state every instance shares, so
 * the counter lives there, incremented atomically by a SQL function so two
 * concurrent requests cannot both read the same pre-increment value.
 *
 * Requires the `auth_throttle` table and `auth_throttle_hit` function from
 * supabase/migrations/0001_security_hardening.sql.
 */

export type RateLimitResult = {
  allowed: boolean
  /** Seconds until the caller may try again. Zero when allowed. */
  retryAfter: number
}

/** Identify the caller. Trusts the platform's proxy headers, not user input. */
export function clientIp(req: NextRequest | Request): string {
  const h = req.headers
  // Vercel sets x-real-ip; x-forwarded-for may be a list, first entry is the client.
  return (
    h.get('x-real-ip') ||
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

/**
 * Record an attempt against `key` and say whether it may proceed.
 *
 * @param key    Scope of the limit, e.g. `login:ip:1.2.3.4` or `login:user:<id>`.
 * @param limit  Attempts permitted inside the window.
 * @param windowSeconds  Length of the counting window.
 * @param blockSeconds   How long to refuse once the limit is passed.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  blockSeconds: number
): Promise<RateLimitResult> {
  try {
    const sb = createServiceClient()
    const { data, error } = await sb.rpc('auth_throttle_hit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
      p_block_seconds: blockSeconds,
    })

    if (error) {
      // The one case we deliberately allow through is the migration not having
      // been applied yet, so that deploying code before running the SQL does
      // not lock every member of staff out of the portal. Everything else is
      // treated as a failure to verify, and refused.
      if (/does not exist|could not find|schema cache/i.test(error.message)) {
        console.error(
          '[rateLimit] auth_throttle_hit is missing — login throttling is NOT active. ' +
          'Run supabase/migrations/0001_security_hardening.sql.'
        )
        return { allowed: true, retryAfter: 0 }
      }
      console.error('[rateLimit] refusing request, throttle check failed:', error.message)
      return { allowed: false, retryAfter: blockSeconds }
    }

    const row = Array.isArray(data) ? data[0] : data
    return {
      allowed: row?.allowed !== false,
      retryAfter: row?.retry_after ?? 0,
    }
  } catch (e) {
    console.error('[rateLimit] refusing request, throttle check threw:', e)
    return { allowed: false, retryAfter: blockSeconds }
  }
}

/** Clear a counter after a successful attempt. */
export async function clearRateLimit(key: string): Promise<void> {
  try {
    const sb = createServiceClient()
    await sb.rpc('auth_throttle_reset', { p_key: key })
  } catch {
    /* A stale counter expires on its own; never fail a good login over this. */
  }
}

/** A human sentence for a retry delay. */
export function retryMessage(seconds: number): string {
  if (seconds <= 60) return 'Please wait a minute and try again.'
  const mins = Math.ceil(seconds / 60)
  return `Please try again in ${mins} minute${mins === 1 ? '' : 's'}.`
}

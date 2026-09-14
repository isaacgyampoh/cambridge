import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Add one to a counter without losing the other person's.
 *
 * ── THE BUG ────────────────────────────────────────────────────────────────
 *
 * Three counters were kept like this:
 *
 *     const { data: f } = await sb.from('flyers').select('clicks')…
 *     await sb.from('flyers').update({ clicks: (f.clicks || 0) + 1 })…
 *
 * Two people opening the same flyer in the same second both read 40, both
 * write 41, and one view is gone. Nothing errors and nothing is logged — the
 * number is just lower than the truth, and it drifts further the more a flyer
 * is shared. The campaign doing best has the worst figures, which is exactly
 * backwards from what it is for.
 *
 * ── WHY THERE IS STILL A FALLBACK ──────────────────────────────────────────
 *
 * bump_counter ships in 0018_atomic_counters.sql, and code is deployed before
 * migrations are run. If the function is not there yet, falling back to the
 * old read-then-write keeps counting — slightly lossy under concurrency,
 * which is what it already was — rather than losing every count until someone
 * runs the SQL.
 *
 * This mirrors lib/auth/rateLimit.ts, which treats a missing auth_throttle_hit
 * the same way and says so loudly. Any OTHER error is a real failure and is
 * reported, not swallowed.
 */

type Countable =
  | { table: 'flyers'; column: 'clicks' | 'leads' }
  | { table: 'referral_codes'; column: 'referrals_count' }

/**
 * @returns the new value, or null when nothing was counted. Callers treat
 *          null as "leave it alone" — a counter is never worth failing a
 *          person's request over.
 */
export async function bumpCounter(
  what: Countable,
  id: string,
  by = 1,
): Promise<number | null> {
  const sb = createServiceClient()

  const { data, error } = await sb.rpc('bump_counter', {
    p_table: what.table,
    p_column: what.column,
    p_id: id,
    p_by: by,
  })

  if (!error) {
    const n = Array.isArray(data) ? data[0] : data
    return typeof n === 'number' ? n : null
  }

  // Migration not applied yet — keep counting the old way.
  if (/does not exist|could not find|schema cache/i.test(error.message)) {
    console.error(
      `[counter] bump_counter is missing — ${what.table}.${what.column} is being counted ` +
      'with a read-then-write and can lose concurrent increments. ' +
      'Run supabase/migrations/0018_atomic_counters.sql.',
    )
    return legacyBump(what, id, by)
  }

  console.error(`[counter] ${what.table}.${what.column} not incremented:`, error.message)
  return null
}

/**
 * The old path, kept only for the window between deploying and migrating.
 *
 * It still refuses to write a counter it could not read — that was the other
 * half of the original bug, where `(f?.clicks || 0) + 1` turned an unreadable
 * row into 1 and wrote a flyer's running total back down to a single click.
 */
async function legacyBump(what: Countable, id: string, by: number): Promise<number | null> {
  const sb = createServiceClient()
  const { data, error } = await sb.from(what.table).select(what.column).eq('id', id).maybeSingle()
  if (error || !data) return null

  const current = Number((data as Record<string, unknown>)[what.column] ?? 0)
  const next = (Number.isFinite(current) ? current : 0) + by
  const { error: writeErr } = await sb.from(what.table).update({ [what.column]: next }).eq('id', id)
  return writeErr ? null : next
}

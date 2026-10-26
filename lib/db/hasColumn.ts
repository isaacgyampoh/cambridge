import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Does this table have this column, on the database we are actually talking to?
 *
 * ── WHY THIS IS NEEDED AT ALL ──────────────────────────────────────────────
 *
 * PostgREST refuses the WHOLE statement when an insert names a column that
 * does not exist. So a deployment whose code is ahead of its migrations does
 * not write a row without the new field — it writes nothing, and reports an
 * error for every row.
 *
 * This project has paid for that once already: an insert named
 * lead_assign_pending.last_sms_at before the column existed, and every
 * assignment notification stopped. The symptom was silence, which is the
 * worst possible symptom.
 *
 * So a new column is asked about before it is written to. Code can then ship
 * before its migration runs, and the only consequence is that the new field
 * is not recorded until it does — which is a missing field rather than a
 * missing import.
 *
 * ── THE CACHE ──────────────────────────────────────────────────────────────
 *
 * A positive answer is cached for the life of the process: a column does not
 * disappear. A negative answer is re-checked after a minute, because the
 * whole point is that somebody is about to run the migration, and a serverless
 * instance that cached "no" forever would keep dropping the field long after
 * it existed.
 */

type Entry = { present: boolean; checkedAt: number }
const cache = new Map<string, Entry>()
const RECHECK_MISSING_AFTER_MS = 60_000

/** Exposed for tests, and for a deployment that has just run its migrations. */
export function forgetColumnCache(): void {
  cache.clear()
}

export async function columnExists(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`
  const cached = cache.get(key)
  if (cached?.present) return true
  if (cached && Date.now() - cached.checkedAt < RECHECK_MISSING_AFTER_MS) return false

  let present = false
  try {
    const sb = createServiceClient()
    // One row, one column. Selecting the column is the question: PostgREST
    // answers 42703 when it does not exist.
    const { error } = await sb.from(table).select(column).limit(1)
    if (!error) {
      present = true
    } else if (!/does not exist|42703|could not find/i.test(error.message)) {
      /*
       * A failed read is NOT an absent column. An outage, a key problem or a
       * policy change would otherwise be read as "the schema is old", and the
       * field would be dropped from every write for as long as the fault
       * lasted — silently, which is the failure this file exists to avoid.
       *
       * Left uncached and reported, so the next call asks again.
       */
      console.error(`[hasColumn] could not establish whether ${key} exists:`, error.message)
      return false
    }
  } catch (e) {
    console.error(`[hasColumn] probe for ${key} threw:`, e instanceof Error ? e.message : e)
    return false
  }

  cache.set(key, { present, checkedAt: Date.now() })
  return present
}

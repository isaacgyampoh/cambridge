import 'server-only'
import { NextResponse } from 'next/server'

/**
 * A lookup that cannot pretend a failure was an absence.
 *
 * ── THE BUG THIS EXISTS TO STOP ────────────────────────────────────────────
 *
 * Fifty-seven places in this application read a row like this:
 *
 *     const { data: row } = await sb.from('…').select(…).maybeSingle()
 *     if (!row) return NextResponse.json({ error: '…' }, { status: 400 })
 *
 * The error is discarded, so `row` is null for two completely different
 * reasons — the record does not exist, or the database could not be read —
 * and both produce the same refusal. Every one of those refusals is written
 * as a statement about the caller:
 *
 *     "That programme is not open for registration."
 *     "Your sign-in has expired. Please start again."
 *     "This lead no longer exists."
 *
 * During an outage, an expired key or a policy change, all of those are false
 * and none of them can be acted on. Somebody trying to pay is told the course
 * is closed. Somebody signing in is told their session expired, so they start
 * again, and are told the same thing.
 *
 * ── WHY A HELPER RATHER THAN A RULE ────────────────────────────────────────
 *
 * "Remember to destructure error" is a rule, and the evidence is that it was
 * not remembered fifty-seven times. Returning `failed` beside `row` makes the
 * distinction sit in front of whoever writes the next one, and the compiler
 * does not let it be renamed away silently.
 *
 * It is deliberately tiny. There is no repository layer here and this is not
 * the beginning of one — it is one function that makes a mistake harder to
 * make than to avoid.
 */

/*
 * The row type is taken from the query's own resolved shape rather than from
 * a type parameter. Supabase's builder is not a plain PromiseLike<{data: T}>,
 * so a `lookup<T>(query)` signature inferred T as `never` and every field
 * access afterwards failed to compile.
 */
type QueryLike = PromiseLike<{ data: unknown; error: { message: string } | null }>

type RowOf<Q extends QueryLike> = NonNullable<Awaited<Q>['data']>

export type LookupResult<T> = {
  /** The row, or null when it genuinely is not there. */
  row: T | null
  /** The reason the read failed, or null when it did not. Check this FIRST. */
  failed: string | null
}

/**
 * Run a single-row query and keep the two outcomes apart.
 *
 * ```ts
 * const { row: lead, failed } = await lookup(
 *   sb.from('leads').select('*').eq('id', id).maybeSingle(),
 * )
 * if (failed) return unavailable('[leads/detail]', failed)
 * if (!lead) return NextResponse.json({ error: 'That lead no longer exists.' }, { status: 404 })
 * ```
 */
export async function lookup<Q extends QueryLike>(query: Q): Promise<LookupResult<RowOf<Q>>> {
  try {
    const { data, error } = await query
    if (error) return { row: null, failed: error.message }
    return { row: (data ?? null) as RowOf<Q> | null, failed: null }
  } catch (e) {
    // A thrown query — the client could not reach the database at all.
    return { row: null, failed: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * The answer to give when a read failed.
 *
 * 503 rather than 400 or 404, because nothing about the request was wrong and
 * repeating it in a moment is the right thing for the caller to do. The
 * message says so, and says nothing about the database — a person reading it
 * does not need the cause, only whether to try again.
 *
 * The reason is logged, because a failure nobody recorded is one nobody can
 * fix.
 */
export function unavailable(where: string, reason: string, what = 'that'): NextResponse {
  console.error(`${where} read failed:`, reason)
  return NextResponse.json(
    { error: `We could not load ${what} just now. Please try again in a moment.` },
    { status: 503 },
  )
}

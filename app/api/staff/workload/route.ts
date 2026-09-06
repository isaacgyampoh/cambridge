import { NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * How many open leads each member of staff is carrying.
 *
 * ── WHY A MANAGER NEEDS THIS ON THE STAFF SCREEN ───────────────────────────
 *
 * The reported symptom was "some staff get the lead, some do not". The cause
 * was a weighted lottery in the assignment code, and it is fixed — but nobody
 * could SEE the distribution, which is why an 8-to-23 spread ran for months
 * without being noticed. The staff list showed a name, a role and whether the
 * person was in the pool, and nothing about what any of them were actually
 * holding.
 *
 * Counted in Postgres and grouped there rather than pulling every lead into
 * the browser to tally: at 186 leads either would work, and at ten thousand
 * only one of them does.
 *
 * "Open" excludes the terminal statuses. Someone with two hundred registered
 * leads is not busy; someone with thirty they still have to ring is.
 */

const CLOSED = ['registered', 'not_interested', 'lost', 'done', 'zuku']

export const GET = withGuard({ portals: ['staff', 'leads', 'pm_leads', 'marketers'] }, async () => {
  const sb = createServiceClient()

  // One row per assigned lead that is still live. Only the owner column is
  // selected, so the payload is a column of uuids rather than whole records.
  const { data, error } = await sb
    .from('leads')
    .select('assigned_to')
    .not('assigned_to', 'is', null)
    .not('status', 'in', `(${CLOSED.join(',')})`)
    .limit(20000)

  if (error) {
    // Surfaced rather than swallowed: a workload of zero everywhere because
    // the query failed must not look like an evenly idle team.
    console.error('[staff/workload]', error.message)
    return NextResponse.json({ error: 'Could not count assigned leads.' }, { status: 500 })
  }

  const open: Record<string, number> = {}
  for (const row of data || []) {
    const owner = row.assigned_to as string | null
    if (owner) open[owner] = (open[owner] || 0) + 1
  }

  const counts = Object.values(open)
  return NextResponse.json({
    open,
    // The spread is the number that matters. A fair distribution and a badly
    // skewed one have the same total, and only this tells them apart.
    spread: counts.length
      ? { min: Math.min(...counts), max: Math.max(...counts), people: counts.length }
      : { min: 0, max: 0, people: 0 },
  })
})

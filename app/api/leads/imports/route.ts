import { NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Import history and row-level results.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Migration 0011 records an outcome and a reason for EVERY row of every
 * import — assigned, unassigned, duplicate, invalid or failed — precisely so
 * that "480 of 500 imported" can be traced to the twenty rows behind it.
 * Nothing surfaced any of it. The administrator saw a set of totals and had no
 * way to find out which people were missing or why, which is the same position
 * they were in before the import was rebuilt.
 *
 *   ?                    — recent imports
 *   ?reference=IMPORT-…  — one import, with its rows
 *   &outcome=invalid     — just the rows that need attention
 */

const ROW_LIMIT = 500

/** Outcomes a caller may filter on. Anything else is refused, not ignored. */
const OUTCOMES = ['assigned', 'unassigned', 'duplicate', 'invalid', 'failed']

export const GET = withGuard({ portals: ['leads', 'pm_leads'] }, async (req) => {
  const url = new URL(req.url)
  const reference = url.searchParams.get('reference')
  const outcome = url.searchParams.get('outcome')
  const sb = createServiceClient()

  /* ── the list ─────────────────────────────────────────────────────────── */

  if (!reference) {
    const { data, error } = await sb.from('lead_imports')
      .select('id, reference, filename, status, total_received, valid, invalid, duplicates, assigned, unassigned, failed, started_at, finished_at, imported_by')
      .order('started_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[imports] list failed:', error.message)
      return NextResponse.json({ error: 'Could not load import history.' }, { status: 500 })
    }
    return NextResponse.json({ imports: data || [] })
  }

  /* ── one import ───────────────────────────────────────────────────────── */

  const { data: record, error: recordError } = await sb.from('lead_imports')
    .select('id, reference, filename, status, total_received, valid, invalid, duplicates, assigned, unassigned, failed, started_at, finished_at, imported_by')
    .eq('reference', reference)
    .maybeSingle()

  if (recordError) {
    console.error('[imports] lookup failed:', recordError.message)
    return NextResponse.json({ error: 'Could not load that import.' }, { status: 500 })
  }
  if (!record) {
    return NextResponse.json({ error: `No import found with the reference ${reference}.` }, { status: 404 })
  }

  if (outcome && !OUTCOMES.includes(outcome)) {
    return NextResponse.json({ error: `Unknown outcome "${outcome}".` }, { status: 400 })
  }

  let rowQuery = sb.from('lead_import_rows')
    .select('id, row_number, lead_id, outcome, reason, payload')
    .eq('import_id', record.id)
    .order('row_number')
    .limit(ROW_LIMIT)
  if (outcome) rowQuery = rowQuery.eq('outcome', outcome)

  // Who ran it. A separate lookup because imported_by is a plain uuid column
  // with no foreign key to embed through.
  const [{ data: rows, error: rowError }, { data: actor }] = await Promise.all([
    rowQuery,
    record.imported_by
      ? sb.from('profiles').select('full_name').eq('id', record.imported_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  if (rowError) {
    console.error('[imports] rows failed:', rowError.message)
    return NextResponse.json({ error: 'Could not load the rows for that import.' }, { status: 500 })
  }

  return NextResponse.json({
    import: { ...record, imported_by_name: actor?.full_name || null },
    rows: (rows || []).map(row => ({
      id: row.id,
      rowNumber: row.row_number,
      leadId: row.lead_id,
      outcome: row.outcome,
      // The reason is stored verbatim, which for a `failed` row can be a
      // database message. Translated here rather than shown raw.
      reason: explain(row.outcome, row.reason),
      name: readName(row.payload),
      phone: readPhone(row.payload),
    })),
    truncated: (rows?.length || 0) === ROW_LIMIT,
  })
})

function readName(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>).full_name
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return '(no name)'
}

function readPhone(payload: unknown): string | null {
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>).phone
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/**
 * Say what happened in words an administrator can act on.
 *
 * The stored reason for a `failed` row can be a Postgres error — "duplicate
 * key value violates unique constraint idx_leads_phone" — which tells whoever
 * is looking at the screen nothing they can do anything about, and discloses
 * the schema. The recognisable ones are translated; anything unrecognised is
 * reported as needing a second look rather than dressed up as understood.
 */
function explain(outcome: string, reason: string | null): string {
  const raw = (reason || '').trim()

  switch (outcome) {
    case 'assigned':
      return 'Added and assigned to a marketer.'
    case 'duplicate':
      return 'Already in the system — this person was not added twice.'
    case 'unassigned':
      if (/nobody currently holds/i.test(raw)) {
        return 'Added, but nobody currently holds the Leads access, so there was no one to assign them to.'
      }
      return 'Added, but no marketer could be selected. Assign them by hand.'
    case 'invalid':
      // These come from lib/leads/importValidation.ts and are already written
      // for a person, so they are passed through.
      return raw || 'The row could not be read.'
    case 'failed':
      if (/duplicate key|unique constraint/i.test(raw)) {
        return 'Another record with the same phone or email was created at the same moment.'
      }
      if (/invalid input value for enum/i.test(raw)) {
        return 'The source column contains a value the system does not recognise.'
      }
      if (/violates check constraint/i.test(raw)) {
        return 'One of the values in this row is not allowed.'
      }
      if (/timeout|timed out/i.test(raw)) {
        return 'The database did not respond in time. Import this row again.'
      }
      return 'This row could not be saved. Import it again, and tell support if it fails a second time.'
    default:
      return raw || 'No reason was recorded.'
  }
}

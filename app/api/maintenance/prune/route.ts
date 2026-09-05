import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Nightly log retention.
 *
 * An audit of the live database found webhook_inbox holding 10,653 rows — a
 * third of the whole database — grown over 23 days with nothing ever removing
 * them. This calls prune_old_logs(), which applies the retention windows set
 * in migration 0007.
 *
 * audit_logs is deliberately never pruned.
 */
export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createServiceClient()
  const { data, error } = await sb.rpc('prune_old_logs')

  if (error) {
    // Missing function means migration 0007 has not been applied yet. That is
    // not an emergency — say so plainly rather than failing the whole cron run.
    if (/could not find|does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json({
        ok: false,
        skipped: 'prune_old_logs() does not exist — apply migration 0007.',
      })
    }
    console.error('[prune] failed:', error.message)
    return NextResponse.json({ ok: false, error: 'Pruning failed.' }, { status: 500 })
  }

  const rows = (data || []) as Array<{ table_name: string; rows_deleted: number }>
  const total = rows.reduce((n, r) => n + Number(r.rows_deleted || 0), 0)
  console.log('[prune] removed', total, 'rows:', rows)

  return NextResponse.json({ ok: true, totalDeleted: total, byTable: rows })
}

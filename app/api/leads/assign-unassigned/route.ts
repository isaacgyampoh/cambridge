import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { isValidCronRequest } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { eligibleMarketers } from '@/lib/leads/eligibility'
import { assignBacklog } from '@/lib/leads/backlog'
import { unavailable } from '@/lib/db/lookup'

export const runtime = 'nodejs'
// A large backlog is worked through in one request, inside this limit.
export const maxDuration = 60

const ALLOWED = ['super_admin', 'project_manager']

async function authorised(req: NextRequest): Promise<'person' | 'scheduler' | null> {
  if (isValidCronRequest(req)) return 'scheduler'
  const token = req.cookies.get('cce_session')?.value
  const s: { valid?: boolean; role?: string } = token ? await verifySession(token) : { valid: false }
  return s.valid && ALLOWED.includes(s.role || '') ? 'person' : null
}

/** How many are waiting, and who assignment will consider. */
export async function GET(req: NextRequest) {
  if (!await authorised(req)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { count: unassigned, error } = await sb.from('leads')
    .select('id', { count: 'exact', head: true }).is('assigned_to', null)
  // A failed count is not zero waiting leads.
  if (error) return unavailable('[assign-unassigned]', error.message, 'the unassigned leads')

  let pool
  try { pool = await eligibleMarketers() }
  catch (e) { return unavailable('[assign-unassigned]', String(e), 'the staff who can receive leads') }

  return NextResponse.json({
    unassigned: unassigned || 0,
    poolSize: pool.length,
    pool: pool.map(m => ({ name: m.fullName, role: m.role })),
    reason: pool.length === 0
      ? 'Nobody can currently receive leads. A person is eligible only when their access includes the Leads portal and they are not opted out of the lead pool.'
      : null,
  })
}

/**
 * Assign every waiting lead: named owner first, then the configured
 * percentages. Each person is notified once for all of theirs.
 */
export async function POST(req: NextRequest) {
  const who = await authorised(req)
  if (!who) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const result = await assignBacklog({
    // Somebody pressing the button has decided; the scheduler defers to the switch.
    respectToggle: who === 'scheduler',
    budgetMs: 50_000,
  })

  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 503 })
  return NextResponse.json({ success: true, ...result })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { readQuota } from '@/lib/leads/quota'
import { isEligible } from '@/lib/leads/eligibility'
import { saveFailed, unavailable } from '@/lib/db/lookup'

export const runtime = 'nodejs'

/**
 * Setting and reading a member's target for a period.
 *
 * Writes to marketer_targets, which has existed since schema-v3 and which
 * nothing has ever written to — so a target could be neither set nor seen.
 * This is the missing half; lib/leads/quota.ts is the read.
 *
 * A target is a TARGET, not a cap. Nothing anywhere refuses to assign a lead
 * because somebody has reached it, and this deliberately does not introduce
 * that: turning an unused reporting figure into a hard limit on who receives
 * leads would change how the business runs on the strength of a column nobody
 * has looked at yet.
 */

const MANAGERS = ['super_admin', 'project_manager', 'administrator']

const Body = z.object({
  marketerId: z.string().uuid(),
  targetLeads: z.number().int().min(0).max(100000),
  targetConversions: z.number().int().min(0).max(100000).optional(),
  /** ISO dates. Defaults to the current calendar month. */
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodLabel: z.string().trim().max(40).optional(),
})

async function session(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: { valid?: boolean; role?: string; userId?: string } =
    token ? await verifySession(token) : { valid: false }
  return s.valid ? s : null
}

/** A member reads their own; a manager may read anybody's. */
export async function GET(req: NextRequest) {
  const s = await session(req)
  if (!s) return NextResponse.json({ error: 'Please sign in to continue.' }, { status: 401 })

  const asked = req.nextUrl.searchParams.get('marketerId')
  const target = asked || (s.userId as string)

  if (asked && asked !== s.userId && !MANAGERS.includes(s.role || '')) {
    return NextResponse.json(
      { error: 'You can only see your own target.' },
      { status: 403 },
    )
  }

  const result = await readQuota(target)
  if (!result.ok) return unavailable('[marketer/quota]', result.reason, 'that target')
  return NextResponse.json({ quota: result.quota })
}

export async function POST(req: NextRequest) {
  const s = await session(req)
  if (!s) return NextResponse.json({ error: 'Please sign in to continue.' }, { status: 401 })

  if (!MANAGERS.includes(s.role || '')) {
    return NextResponse.json(
      { error: 'Only an administrator or project manager can set a target.' },
      { status: 403 },
    )
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'That target could not be read.' },
      { status: 400 },
    )
  }
  const body = parsed.data

  // A target only means something for somebody who can receive leads.
  if (!await isEligible(body.marketerId)) {
    return NextResponse.json(
      { error: 'That person cannot receive leads, so a lead target would never move.' },
      { status: 400 },
    )
  }

  const now = new Date()
  const periodStart = body.periodStart
    ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const periodEnd = body.periodEnd
    ?? new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)

  if (periodEnd < periodStart) {
    return NextResponse.json(
      { error: 'The period ends before it starts.' },
      { status: 400 },
    )
  }

  const sb = createServiceClient()

  /*
   * One target per person per period. There is no unique constraint on
   * marketer_targets to upsert against, so an existing row for exactly this
   * period is updated and anything else is inserted — otherwise setting a
   * target twice would leave two rows and the read would pick one of them.
   */
  const { data: existing, error: findError } = await sb.from('marketer_targets')
    .select('id')
    .eq('marketer_id', body.marketerId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .limit(1).maybeSingle()

  if (findError) return unavailable('[marketer/quota]', findError.message, 'the current target')

  const row = {
    marketer_id: body.marketerId,
    period: body.periodLabel || 'monthly',
    period_start: periodStart,
    period_end: periodEnd,
    target_leads: body.targetLeads,
    target_conversions: body.targetConversions ?? 0,
    set_by: s.userId,
  }

  const { error: writeError } = existing
    ? await sb.from('marketer_targets').update(row).eq('id', existing.id)
    : await sb.from('marketer_targets').insert(row)

  if (writeError) return saveFailed('[marketer/quota]', writeError.message, 'that target')

  await recordAudit({
    actorId: s.userId,
    action: 'marketer.target_set',
    resource: 'marketer_targets',
    resourceId: body.marketerId,
    success: true,
    request: req,
    metadata: { targetLeads: body.targetLeads, periodStart, periodEnd },
  })

  const after = await readQuota(body.marketerId)
  return NextResponse.json({
    success: true,
    quota: after.ok ? after.quota : null,
  })
}

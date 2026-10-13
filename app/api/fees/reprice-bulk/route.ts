import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { lookup, unavailable } from '@/lib/db/lookup'
import { recordAudit } from '@/lib/audit'
import { planBulkReprice, planMatches } from '@/lib/finance/bulkReprice'
import { feeFor } from '@/lib/academics/manualRegistration'
import { parseClassMode } from '@/lib/classMode'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Put every student on a programme onto its current fee.
 *
 * Two steps, always. A POST with no `confirmIds` returns the PLAN and writes
 * nothing. Applying requires sending back the exact set of ids the plan
 * named, so a plan that has gone stale — somebody registered, paid or was
 * corrected in between — is refused rather than applied to people the
 * operator never saw.
 *
 * Money already received is never touched. See lib/finance/bulkReprice.
 */

const ALLOWED = ['super_admin', 'administrator', 'accountant']

/** A cohort, not a mailing list: enough for any real programme, bounded. */
const MAX_ROWS = 2000

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: { valid?: boolean; role?: string; userId?: string } =
    token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role || '')) {
    return NextResponse.json({ error: 'Only finance may change fees.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const courseId = typeof body.courseId === 'string' ? body.courseId : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  const confirmIds: string[] | null = Array.isArray(body.confirmIds) ? body.confirmIds.filter((x: unknown) => typeof x === 'string') : null

  if (!courseId) return NextResponse.json({ error: 'Choose a programme.' }, { status: 400 })

  const sb = createServiceClient()

  const { row: course, failed: courseFailed } = await lookup(
    sb.from('courses').select('id, name, course_fee, course_fee_online').eq('id', courseId).maybeSingle(),
  )
  if (courseFailed) return unavailable('[fees/reprice-bulk]', courseFailed, 'the programme')
  if (!course) return NextResponse.json({ error: 'That programme no longer exists.' }, { status: 404 })

  const { data: rows, error: rowsError } = await sb.from('student_fees')
    .select('id, student_name, delivery, total_fee, amount_paid')
    .eq('course_id', courseId).limit(MAX_ROWS)
  if (rowsError) return unavailable('[fees/reprice-bulk]', rowsError.message, 'the student fees')

  const plan = planBulkReprice(rows || [], mode => feeFor(course, mode), parseClassMode)

  // ── Step one: show what would happen ─────────────────────────────────────
  if (!confirmIds) {
    return NextResponse.json({
      preview: true,
      course: course.name,
      inPerson: Number(course.course_fee) || 0,
      online: Number(course.course_fee_online) || 0,
      ...plan,
    })
  }

  // ── Step two: apply, but only the plan that was shown ────────────────────
  if (reason.length < 3) {
    return NextResponse.json({ error: 'Say why every student on this programme is being re-priced.' }, { status: 400 })
  }
  if (!plan.changes.length) {
    return NextResponse.json({ error: 'Nothing to change — everybody is already on the current fee.' }, { status: 400 })
  }
  if (!planMatches(plan, confirmIds)) {
    /*
     * The roster moved between the preview and the confirmation. Re-pricing
     * on the old plan would change people the operator never saw listed.
     */
    return NextResponse.json({
      error: 'These students have changed since the preview. Review it again before applying.',
      stale: true, ...plan,
    }, { status: 409 })
  }

  let applied = 0
  const failures: { id: string; why: string }[] = []

  for (const change of plan.changes) {
    /*
     * amount_paid is absent, deliberately and on every row: it is money the
     * centre received and belongs to the payments that recorded it.
     */
    const { error } = await sb.from('student_fees').update({
      total_fee: change.to,
      balance: change.balance,
      status: change.status,
      updated_at: new Date().toISOString(),
    }).eq('id', change.id)

    if (error) { failures.push({ id: change.id, why: error.message }); continue }
    applied++

    await recordAudit({
      actorId: session.userId, action: 'student_fee.reprice', resource: 'student_fees',
      resourceId: change.id, success: true,
      metadata: {
        student: change.student, course: course.name,
        from: change.from, to: change.to, balance: change.balance,
        why: reason, bulk: true,
      },
      request: req,
    })
  }

  await recordAudit({
    actorId: session.userId, action: 'student_fee.reprice_bulk', resource: 'courses',
    resourceId: courseId, success: failures.length === 0,
    metadata: {
      course: course.name, planned: plan.changes.length, applied,
      failed: failures.length, owedBefore: plan.owedBefore, owedAfter: plan.owedAfter,
      why: reason,
    },
    request: req,
  })

  return NextResponse.json({
    success: failures.length === 0,
    applied,
    planned: plan.changes.length,
    failures,
    creditCount: plan.creditCount,
    owedBefore: plan.owedBefore,
    owedAfter: plan.owedAfter,
  })
}

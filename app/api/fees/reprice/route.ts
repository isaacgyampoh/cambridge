import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { lookup, unavailable, saveFailed } from '@/lib/db/lookup'
import { recordAudit } from '@/lib/audit'
import { validateReprice, repriceTo, round2 } from '@/lib/finance/reprice'
import { feeFor } from '@/lib/academics/manualRegistration'
import { parseClassMode } from '@/lib/classMode'

export const runtime = 'nodejs'

/**
 * Correct what a student is charged.
 *
 * student_fees.total_fee is a snapshot taken at registration and nothing
 * could change it afterwards, so a student registered under an old price list
 * showed that price for ever. See lib/finance/reprice for the whole of why.
 *
 * Money already received is never touched. The balance is recomputed from it.
 */

/*
 * Finance owns what a student owes. The academic department registers people
 * and the project manager runs the pipeline; neither prices them.
 */
const ALLOWED = ['super_admin', 'administrator', 'accountant']

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: { valid?: boolean; role?: string; userId?: string } =
    token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role || '')) {
    return NextResponse.json({ error: 'Only finance may change a fee.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const studentFeeId = typeof body.studentFeeId === 'string' ? body.studentFeeId : ''
  if (!studentFeeId) return NextResponse.json({ error: 'Which student?' }, { status: 400 })

  const sb = createServiceClient()

  const { row: fee, failed } = await lookup(
    sb.from('student_fees')
      .select('id, student_name, course_id, course_name, delivery, total_fee, amount_paid')
      .eq('id', studentFeeId).maybeSingle(),
  )
  if (failed) return unavailable('[fees/reprice]', failed, 'that student')
  if (!fee) return NextResponse.json({ error: 'That student record no longer exists.' }, { status: 404 })

  /*
   * "Charge them the current price" is the common case and the one most
   * likely to be mistyped, so it is derived here rather than keyed in. The
   * rule is feeFor — the same one registration uses — so a corrected fee and
   * a newly registered one cannot disagree.
   */
  let requested: unknown = body.totalFee
  if (body.useCourseFee === true) {
    if (!fee.course_id) {
      return NextResponse.json({ error: 'This record has no programme, so there is no current fee to apply.' }, { status: 400 })
    }
    const { row: course, failed: courseFailed } = await lookup(
      sb.from('courses').select('course_fee, course_fee_online').eq('id', fee.course_id).maybeSingle(),
    )
    if (courseFailed) return unavailable('[fees/reprice]', courseFailed, 'the programme')
    if (!course) return NextResponse.json({ error: 'That programme no longer exists.' }, { status: 400 })

    const mode = parseClassMode(fee.delivery)
    if (!mode) {
      // Guessing would charge the in-person price to an online student.
      return NextResponse.json({
        error: 'This record does not say whether the student attends in person or online, so the current fee cannot be chosen for them. Enter the amount.',
      }, { status: 400 })
    }
    requested = feeFor(course, mode)
  }

  const checked = validateReprice({
    totalFee: requested, reason: body.reason, currentTotal: Number(fee.total_fee) || 0,
  })
  if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 })

  const next = repriceTo(checked.totalFee, Number(fee.amount_paid) || 0)
  const previousTotal = round2(Number(fee.total_fee) || 0)

  /*
   * amount_paid is deliberately absent from this update. It is money the
   * centre received, it belongs to the payments that recorded it, and a
   * re-price that moved it would make the ledger disagree with the receipts.
   */
  const { error: updateError } = await sb.from('student_fees').update({
    total_fee: next.totalFee,
    balance: next.balance,
    status: next.status,
    updated_at: new Date().toISOString(),
  }).eq('id', studentFeeId)

  if (updateError) {
    await recordAudit({
      actorId: session.userId, action: 'student_fee.reprice', resource: 'student_fees',
      resourceId: studentFeeId, success: false,
      metadata: { reason: updateError.message }, request: req,
    })
    return saveFailed('[fees/reprice]', updateError.message, 'that fee')
  }

  await recordAudit({
    actorId: session.userId, action: 'student_fee.reprice', resource: 'student_fees',
    resourceId: studentFeeId, success: true,
    metadata: {
      student: fee.student_name, course: fee.course_name,
      from: previousTotal, to: next.totalFee,
      amountPaid: next.amountPaid, balance: next.balance,
      why: checked.reason, fromCourseFee: body.useCourseFee === true,
    },
    request: req,
  })

  return NextResponse.json({
    success: true,
    previousTotal,
    totalFee: next.totalFee,
    amountPaid: next.amountPaid,
    balance: next.balance,
    status: next.status,
    /*
     * Said explicitly so the screen can warn rather than quietly show a
     * negative balance: a fee corrected below what was already paid leaves
     * the student in credit, which is a real state and an unusual one.
     */
    inCredit: next.balance < 0,
  })
}

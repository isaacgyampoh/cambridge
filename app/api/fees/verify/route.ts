import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { withGuard } from '@/lib/auth/guard'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { queueSMS } from '@/lib/notifications/sms'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * Finance verifies, or rejects, a pending bank or cash payment.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * Two defects, both capable of moving money the wrong way.
 *
 * The balance was computed in application code —
 *
 *     newPaid = Number(fee.amount_paid) + confirmed
 *
 * read first, written second. Two verifications landing together both read the
 * same starting figure and the second overwrote the first, so one student's
 * payment vanished from the ledger while their receipt said otherwise.
 *
 * Worse, the order was reversed: student_fees was updated BEFORE the payment
 * was marked verified, and neither write was checked. If the second failed,
 * the balance had already moved while the payment stayed 'pending' — sitting
 * in the queue for finance to verify a second time, crediting it twice.
 *
 * ── THE ORDER NOW ──────────────────────────────────────────────────────────
 *
 *   claim the payment (pending -> verified, conditionally)
 *   then apply the balance, atomically
 *
 * The claim is what makes this safe. Updating with .eq('status','pending')
 * and asking which row came back means exactly one caller can win, so a
 * double-click, a retried request or two accountants on the same screen
 * cannot credit the same payment twice. If the balance step then fails, the
 * payment is already spoken for — the failure is recorded and surfaced rather
 * than being left to look like unfinished work.
 */

const FINANCE_ROLES = ['super_admin', 'project_manager', 'accountant']

export const GET = withGuard({ roles: FINANCE_ROLES }, async () => {
  const sb = createServiceClient()
  const { data, error } = await sb.from('fee_payments')
    .select('*, fee:student_fee_id(student_name, course_name, total_fee, amount_paid, balance)')
    .order('created_at', { ascending: false }).limit(200)

  if (error) {
    // Surfaced, not swallowed: an empty payments list because the query failed
    // must not look like an empty list because nothing is pending.
    console.error('[fees/verify] could not load payments:', error.message)
    return NextResponse.json({ error: 'Could not load payments.' }, { status: 500 })
  }
  return NextResponse.json({ payments: data || [] })
})

export const POST = withGuard({ roles: FINANCE_ROLES }, async (req, { session }) => {
  const { paymentId, action, amount } = await req.json()
  if (!paymentId || !['verify', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Missing payment or action' }, { status: 400 })
  }

  const sb = createServiceClient()
  const now = new Date().toISOString()

  const { data: pay, error: payErr } = await sb.from('fee_payments')
    .select('*').eq('id', paymentId).maybeSingle()

  if (payErr) {
    console.error('[fees/verify] could not read payment:', payErr.message)
    return NextResponse.json({ error: 'Could not load that payment.' }, { status: 500 })
  }
  if (!pay || pay.status !== 'pending') {
    return NextResponse.json({ error: 'Payment not found or already handled' }, { status: 400 })
  }

  /* ── rejection ────────────────────────────────────────────────────────── */

  if (action === 'reject') {
    const { data: rejected, error } = await sb.from('fee_payments')
      .update({ status: 'rejected', verified_by: session.userId, verified_at: now })
      .eq('id', paymentId).eq('status', 'pending')
      .select('id').maybeSingle()

    if (error) {
      console.error('[fees/verify] rejection failed:', error.message)
      return NextResponse.json({ error: 'Could not reject that payment.' }, { status: 500 })
    }
    if (!rejected) {
      return NextResponse.json({ error: 'Someone else has already handled this payment.' }, { status: 409 })
    }

    await recordAudit({
      actorId: session.userId, action: 'fees.payment_rejected',
      resource: 'fee_payments', resourceId: paymentId, success: true,
      metadata: { amount: pay.amount, method: pay.method },
    })
    return NextResponse.json({ success: true })
  }

  /* ── verification ─────────────────────────────────────────────────────── */

  // Finance may confirm a different figure from the one the student claimed —
  // a partial payment, or a corrected amount. It still has to be a real one.
  const confirmed = Number(amount ?? pay.amount)
  if (!Number.isFinite(confirmed) || confirmed <= 0) {
    return NextResponse.json({ error: 'Enter a valid amount to confirm' }, { status: 400 })
  }

  const { data: fee, error: feeErr } = await sb.from('student_fees')
    .select('*').eq('id', pay.student_fee_id).maybeSingle()

  if (feeErr) {
    console.error('[fees/verify] could not read fee record:', feeErr.message)
    return NextResponse.json({ error: 'Could not load the fee record.' }, { status: 500 })
  }
  if (!fee) return NextResponse.json({ error: 'Fee record not found' }, { status: 404 })

  // Claim it first. Only one caller can move it out of 'pending', so the
  // balance below is applied exactly once however many requests arrive.
  const { data: claimed, error: claimErr } = await sb.from('fee_payments')
    .update({ status: 'verified', amount: confirmed, verified_by: session.userId, verified_at: now })
    .eq('id', paymentId).eq('status', 'pending')
    .select('id, receipt_no').maybeSingle()

  if (claimErr) {
    console.error('[fees/verify] could not claim payment:', claimErr.message)
    return NextResponse.json({ error: 'Could not verify that payment.' }, { status: 500 })
  }
  if (!claimed) {
    return NextResponse.json({ error: 'Someone else has already handled this payment.' }, { status: 409 })
  }

  const { data: applied, error: applyErr } = await sb.rpc('apply_fee_payment_by_id', {
    p_fee: fee.id, p_amount: confirmed,
  })
  const row = Array.isArray(applied) ? applied[0] : applied

  if (applyErr || !row) {
    /*
     * The payment is verified but the ledger did not move.
     *
     * This is deliberately NOT rolled back to 'pending': doing so would put it
     * back in the queue and invite a second credit if the first update had in
     * fact landed. It is recorded loudly instead, and the accountant is told
     * the truth rather than shown a success and a receipt.
     */
    console.error('[fees/verify] payment verified but balance not applied:',
      paymentId, applyErr?.message)
    await recordAudit({
      actorId: session.userId, action: 'fees.balance_not_applied',
      resource: 'fee_payments', resourceId: paymentId, success: false,
      metadata: { studentFeeId: fee.id, amount: confirmed, error: applyErr?.message || 'no row returned' },
    })
    return NextResponse.json({
      error: 'The payment was marked verified, but the student\'s balance did not update. ' +
             'Do not verify it again — raise this with support.',
    }, { status: 500 })
  }

  const newBalance = Number(row.balance) || 0

  await recordAudit({
    actorId: session.userId, action: 'fees.payment_verified',
    resource: 'fee_payments', resourceId: paymentId, success: true,
    metadata: {
      studentFeeId: fee.id, method: pay.method,
      claimed: pay.amount, confirmed, balance: newBalance,
    },
  })

  const first = (fee.student_name || '').split(' ')[0] || 'there'
  const msg = `Hello ${first}, your payment of GHS ${confirmed.toFixed(2)} has been confirmed. ` +
    `Receipt: ${claimed.receipt_no}.` +
    (newBalance > 0
      ? ` Remaining balance: GHS ${newBalance.toFixed(2)}.`
      : ' Your fees are fully paid — thank you!')

  if (fee.phone) {
    try {
      await sendWhatsAppText(fee.phone, msg)
    } catch {
      // The queue, not a bare send. A receipt is precisely the message that
      // must survive one slow provider minute, and dedupe_key means the
      // student is told once however many times this path runs.
      await queueSMS({
        to: fee.phone, message: msg, kind: 'payment_receipt',
        entityId: paymentId, dedupeKey: `receipt:${paymentId}`,
      })
    }
  }

  return NextResponse.json({ success: true, balance: newBalance })
})

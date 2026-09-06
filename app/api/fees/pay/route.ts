import { NextRequest, NextResponse } from 'next/server'
import { releaseMaterialsFor } from '@/lib/materialRelease'
import { createServiceClient } from '@/lib/supabase/server'
import { SECRETS } from '@/lib/config.server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { queueSMS } from '@/lib/notifications/sms'
import { recordAudit } from '@/lib/audit'
import { decidePayment, isKnownMethod, requiresProviderVerification } from '@/lib/payments/decide'

export const runtime = 'nodejs'

/**
 * PUBLIC — a student pays their course fee, from the apply flow or a link.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * This endpoint is public and unauthenticated, which is correct: a student
 * paying their own fees has no staff login. What was not correct is that it
 * believed the request body.
 *
 * The client posted `method: "momo"` and, on that word alone, the payment was
 * marked verified, the balance reduced and a receipt sent. No Paystack check
 * ran anywhere in the path. The fee id needed to do it is handed out by this
 * route's own public GET. Anyone could clear any student's fees with a single
 * request, and the system would text them a receipt confirming it.
 *
 * The amount was taken from the body too, so even a genuine one-cedi payment
 * could be recorded as settling the whole balance.
 *
 * Checked before changing anything: fee_payments held two rows, both cash,
 * and no momo row had ever existed. It was never exploited.
 *
 * ── THE RULE NOW ───────────────────────────────────────────────────────────
 *
 * Nothing the client says about money is trusted. A mobile-money payment is
 * confirmed with Paystack using our secret key, and the amount banked is the
 * amount PAYSTACK reports, not the amount claimed. Bank transfers and cash
 * stay pending for finance to verify, exactly as before — the difference is
 * that they can no longer describe themselves as verified.
 */

/** What Paystack tells us about a reference. Nothing here comes from the client. */
type Verification =
  | { ok: true; amount: number; reference: string }
  | { ok: false; reason: string }

async function verifyWithPaystack(reference: string): Promise<Verification> {
  let key: string
  try {
    key = SECRETS.paystackSecretKey
  } catch {
    // Refusing is the only safe answer. Treating an unconfigured key as
    // "assume it paid" is the bug this function exists to remove.
    console.error('[fees] PAYSTACK_SECRET_KEY is not configured — cannot verify payments.')
    return { ok: false, reason: 'Payments cannot be verified right now. Please contact the office.' }
  }

  try {
    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) }
    )
    const body = await res.json().catch(() => ({}))

    if (!body?.status || body?.data?.status !== 'success') {
      return {
        ok: false,
        reason: body?.data?.gateway_response || body?.message || 'That payment was not successful.',
      }
    }

    // Paystack works in the minor unit.
    return {
      ok: true,
      amount: Number(body.data.amount) / 100,
      reference: String(body.data.reference || reference),
    }
  } catch (e) {
    // A timeout is not a payment. If we cannot confirm it, we do not bank it —
    // the student can retry, and the Paystack webhook settles it either way.
    return { ok: false, reason: `Could not confirm that payment: ${(e as Error).message}` }
  }
}

function receiptFallback(): string {
  return `CCE/RCT/${new Date().getFullYear()}/${Date.now().toString().slice(-6)}`
}

// PUBLIC — look up a student's fee by application, for the apply pay flow.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const applicationId = url.searchParams.get('applicationId')
  if (!applicationId) return NextResponse.json({ error: 'Missing application' }, { status: 400 })

  const sb = createServiceClient()
  const { data: fee, error } = await sb.from('student_fees')
    .select('id, lead_id, student_name, course_name, total_fee, amount_paid, balance, status, phone')
    .eq('application_id', applicationId).maybeSingle()

  if (error) {
    console.error('[fees] lookup failed:', error.message)
    return NextResponse.json({ error: 'Could not load your fee record.' }, { status: 500 })
  }
  if (!fee) return NextResponse.json({ found: false })
  return NextResponse.json({ found: true, fee })
}

export async function POST(req: NextRequest) {
  const { studentFeeId, amount, method, paystackRef, screenshotUrl } = await req.json()
  if (!studentFeeId || !method) {
    return NextResponse.json({ error: 'Missing details' }, { status: 400 })
  }
  if (!isKnownMethod(method)) {
    return NextResponse.json({ error: 'Unknown payment method' }, { status: 400 })
  }

  const sb = createServiceClient()
  const { data: fee, error: feeErr } = await sb.from('student_fees')
    .select('*').eq('id', studentFeeId).maybeSingle()

  if (feeErr) {
    console.error('[fees] could not read fee record:', feeErr.message)
    return NextResponse.json({ error: 'Could not load your fee record.' }, { status: 500 })
  }
  if (!fee) return NextResponse.json({ error: 'Fee record not found' }, { status: 404 })

  /* ── how much, and is it real? ────────────────────────────────────────── */

  /*
   * Mobile money is confirmed with Paystack using our secret key BEFORE any
   * decision is taken. The decision itself lives in lib/payments/decide.ts so
   * that the rules — provider amount wins, no verification means rejection,
   * a nonsensical provider amount moves nothing — are under test rather than
   * spread through this handler.
   */
  const verification = requiresProviderVerification(method) && paystackRef
    ? await verifyWithPaystack(String(paystackRef))
    : null

  const decision = decidePayment(
    { method, amount, reference: paystackRef ? String(paystackRef) : null },
    verification
  )

  if (decision.outcome === 'rejected') {
    await recordAudit({
      action: 'fees.payment_rejected',
      resource: 'student_fees',
      resourceId: fee.id,
      success: false,
      metadata: { method, reference: paystackRef ? String(paystackRef) : null, reason: decision.reason },
    })
    return NextResponse.json({ error: decision.reason }, { status: 400 })
  }

  const verified = decision.outcome === 'verified'
  const amt = decision.amount
  const reference = decision.reference

  /* ── record it, exactly once ──────────────────────────────────────────── */

  const { data: generated } = await sb.rpc('next_receipt_number')
  const rcpt = (generated as string) || receiptFallback()

  const { data: payment, error: payErr } = await sb.from('fee_payments').insert({
    student_fee_id: fee.id, application_id: fee.application_id,
    student_name: fee.student_name, phone: fee.phone,
    amount: amt, method, status: verified ? 'verified' : 'pending',
    paystack_ref: reference, screenshot_url: screenshotUrl || null,
    receipt_no: rcpt, verified_at: verified ? new Date().toISOString() : null,
  }).select('id').single()

  if (payErr) {
    // The unique index on paystack_ref is the real guarantee that one Paystack
    // transaction is banked once. A repeat is not an error to the student —
    // their payment is already recorded — but it must not credit twice.
    if (/duplicate key|unique constraint/i.test(payErr.message)) {
      const { data: existing } = await sb.from('fee_payments')
        .select('receipt_no, amount').eq('paystack_ref', reference).maybeSingle()
      return NextResponse.json({
        success: true, verified: true, duplicate: true,
        receiptNo: existing?.receipt_no || rcpt,
        amount: existing?.amount ?? amt,
        balance: Number(fee.balance) || 0,
        message: 'This payment has already been recorded.',
      })
    }
    // Never tell a student their payment went through when it was not stored.
    console.error('[fees] could not record payment:', payErr.message)
    return NextResponse.json(
      { error: 'We could not record that payment. Please contact the office before paying again.' },
      { status: 500 }
    )
  }

  /* ── move the balance, atomically ─────────────────────────────────────── */

  let newBalance = Number(fee.balance) || 0

  if (verified) {
    // The arithmetic happens inside the UPDATE. Computed in application code
    // from a prior SELECT, two payments landing together both read the same
    // starting figure and the second silently overwrites the first.
    const { data: applied, error: applyErr } = await sb.rpc('apply_fee_payment_by_id', {
      p_fee: fee.id, p_amount: amt,
    })

    const row = Array.isArray(applied) ? applied[0] : applied
    if (applyErr || !row) {
      // The payment is banked but the ledger did not move. Say so plainly
      // rather than sending a receipt for a balance that never changed.
      console.error('[fees] payment recorded but balance not applied:',
        fee.id, payment.id, applyErr?.message)
      await recordAudit({
        action: 'fees.balance_not_applied',
        resource: 'fee_payments',
        resourceId: payment.id,
        success: false,
        metadata: { studentFeeId: fee.id, amount: amt, error: applyErr?.message || 'no row returned' },
      })
      return NextResponse.json({
        success: true, verified: true, receiptNo: rcpt, amount: amt,
        balance: newBalance, balanceApplied: false,
        message: 'Your payment was received, but your balance has not updated yet. ' +
                 'Please keep this receipt and contact the office.',
      }, { status: 200 })
    }

    newBalance = Number(row.balance) || 0

    await recordAudit({
      action: 'fees.payment_verified',
      resource: 'fee_payments',
      resourceId: payment.id,
      success: true,
      metadata: { studentFeeId: fee.id, amount: amt, reference, balance: newBalance },
    })

    /* ── tell them ─────────────────────────────────────────────────────── */

    const first = (fee.student_name || '').split(' ')[0] || 'there'
    const msg = `Hello ${first}, we've received your payment of GHS ${amt.toFixed(2)}. Receipt: ${rcpt}.` +
      (newBalance > 0
        ? ` Your remaining balance is GHS ${newBalance.toFixed(2)}.`
        : ' Your fees are fully paid — thank you!')

    if (fee.phone) {
      try {
        await sendWhatsAppText(fee.phone, msg)
      } catch {
        // The queue, not a bare send: a receipt is exactly the message that
        // must not be lost to one slow provider minute. dedupe_key means the
        // student is told once however often this runs.
        await queueSMS({
          to: fee.phone, message: msg, kind: 'payment_receipt',
          entityId: payment.id, dedupeKey: `receipt:${payment.id}`,
        })
      }
    }

    // Unlock any course materials this payment now qualifies them for.
    if (fee.lead_id) {
      try {
        await releaseMaterialsFor(fee.lead_id)
      } catch (e) {
        // Not fatal to the payment, but it must not vanish: someone has to
        // know why a paid-up student cannot see their materials.
        console.error('[fees] material release failed for lead', fee.lead_id, e)
      }
    }

    // A fully paid exam-prep student is ready for their coordinator.
    if (newBalance <= 0 && fee.lead_id) {
      const { data: prep, error: prepErr } = await sb.from('prep_records')
        .select('id, coordinator_id, student_name, program_name')
        .eq('lead_id', fee.lead_id).maybeSingle()

      if (prepErr) console.error('[fees] prep lookup failed:', prepErr.message)

      if (prep?.coordinator_id) {
        const { error: noteErr } = await sb.from('notifications').insert({
          user_id: prep.coordinator_id, type: 'prep',
          title: 'Prep student fully paid',
          body: `${prep.student_name} has cleared their ${prep.program_name || ''} fees and is ready for exam prep.`,
          data: { prep_record_id: prep.id },
        })
        if (noteErr) console.error('[fees] coordinator notification failed:', noteErr.message)
      }
    }
  }

  return NextResponse.json({
    success: true, verified, receiptNo: rcpt, amount: amt, balance: newBalance,
    message: verified
      ? 'Payment received'
      : (method === 'bank'
          ? 'Submitted — finance will verify your transfer'
          : 'Recorded — please pay at the desk'),
  })
}

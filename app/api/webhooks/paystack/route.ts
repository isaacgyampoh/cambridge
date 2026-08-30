import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { releaseMaterialsFor } from '@/lib/materialRelease'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { queueSMS } from '@/lib/notifications/sms'
import { SMS } from '@/lib/integrations/sms'
import { recordAudit } from '@/lib/audit'
import { parseClassMode, classModeLabel } from '@/lib/classMode'
import {
  verifyPaystackSignature, classifyPayment, eventKey,
  minorUnitsToGHS, amountIsAcceptable, type PaystackEvent,
} from '@/lib/payments/verify'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Paystack webhook.
 *
 * Idempotency is the whole point of this file. Paystack retries on any
 * non-2xx, and delivers the same event more than once in normal operation, so
 * "check whether it exists, then insert" is not good enough: two concurrent
 * deliveries both pass the check before either writes.
 *
 * The order here is deliberate:
 *
 *   1. verify the signature (timing-safe)
 *   2. CLAIM the event id — one atomic insert, unique primary key
 *   3. only then do any business work
 *
 * Step 2 is what makes everything after it exactly-once. A second delivery
 * loses the claim and returns 200 immediately, having changed nothing. The
 * payment insert behind it is separately protected by a unique index on
 * payments.reference, so even if the claim table were lost the money could
 * still only be recorded once.
 *
 * Returning 200 for anything we have decided not to act on is intentional:
 * a non-2xx makes Paystack retry, and retrying an event we have deliberately
 * rejected achieves nothing but noise.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  if (!verifyPaystackSignature(rawBody, req.headers.get('x-paystack-signature'))) {
    // 401 and no detail: a caller who cannot sign gets nothing to work with.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: PaystackEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ received: true, note: 'unparseable body' })
  }

  if (event.event !== 'charge.success') {
    return NextResponse.json({ received: true, note: `ignoring ${event.event}` })
  }

  const key = eventKey(event)
  if (!key) return NextResponse.json({ received: true, note: 'event has no identity' })

  const reference = String(event.data?.reference || '')
  if (!reference) return NextResponse.json({ received: true, note: 'no reference' })

  const amount = minorUnitsToGHS(event.data?.amount)
  if (amount === null) return NextResponse.json({ received: true, note: 'no usable amount' })

  const sb = createServiceClient()

  // ── The claim. Everything below runs at most once per event. ──
  const { data: won, error: claimErr } = await sb.rpc('claim_event', {
    p_event_id: key,
    p_source: 'paystack',
  })

  if (claimErr) {
    // We could not establish whether this event was already handled. Doing the
    // work anyway risks a duplicate; the payment insert is separately
    // protected, but the notifications are not. Ask Paystack to retry.
    console.error('[paystack] claim_event failed:', claimErr.message)
    return NextResponse.json({ error: 'Could not verify event state' }, { status: 503 })
  }

  if (!won) {
    return NextResponse.json({ received: true, note: 'already processed' })
  }

  const purpose = classifyPayment(event)

  try {
    if (purpose.kind === 'application') {
      return await handleApplicationPayment(sb, purpose.applicationId, reference, amount, event, req)
    }
    if (purpose.kind === 'course_fee') {
      return await handleCourseFeePayment(sb, purpose.leadId, reference, amount, event, req)
    }

    console.warn('[paystack] unclassified payment', reference)
    await recordAudit({
      action: 'payment.unclassified', resource: 'payments',
      success: false, metadata: { reference }, request: req,
    })
    return NextResponse.json({ received: true, note: 'unclassified' })
  } catch (e) {
    console.error('[paystack] handler threw for', reference, e)
    // The claim is already taken, so a retry would be a no-op. Record it as a
    // failure that a human needs to look at rather than pretending success.
    await recordAudit({
      action: 'payment.processing_failed', resource: 'payments',
      success: false, metadata: { reference, error: String(e) }, request: req,
    })
    return NextResponse.json({ received: true, note: 'recorded for review' })
  }
}

type SB = ReturnType<typeof createServiceClient>

/** Registration fee for an application. */
async function handleApplicationPayment(
  sb: SB, applicationId: string, reference: string,
  amount: number, event: PaystackEvent, req: NextRequest
) {
  const { data: app } = await sb.from('applications')
    .select('*, course:course_id(id, name, registration_fee)')
    .eq('id', applicationId).maybeSingle()

  if (!app) {
    await recordAudit({
      action: 'payment.unknown_application', resource: 'applications',
      resourceId: applicationId, success: false, metadata: { reference }, request: req,
    })
    return NextResponse.json({ received: true, note: 'application not found' })
  }

  // Amount check. Underpayment is refused; overpayment is accepted at its true
  // value, because refusing a registration for paying too much would be absurd.
  const course = (app as { course?: { registration_fee?: number; name?: string } }).course
  const expected = typeof course?.registration_fee === 'number' ? course.registration_fee : null
  const check = amountIsAcceptable(amount, expected)
  if (!check.ok) {
    console.warn('[paystack] amount mismatch on', reference, check.reason)
    await recordAudit({
      action: 'payment.amount_mismatch', resource: 'applications',
      resourceId: applicationId, success: false,
      metadata: { reference, received: amount, expected }, request: req,
    })
    // Recorded, not silently accepted, and not retried.
    return NextResponse.json({ received: true, note: 'amount mismatch recorded' })
  }

  // Record the payment. The unique index on reference is the real guard.
  const { data: rows, error: payErr } = await sb.rpc('record_payment_once', {
    p_reference: reference,
    p_amount: amount,
    p_method: 'paystack',
    p_purpose: 'registration',
    p_application: applicationId,
    p_student: null,
    p_response: event.data ?? null,
  })
  if (payErr) {
    console.error('[paystack] record_payment_once failed:', payErr.message)
    throw new Error(payErr.message)
  }
  const payment = Array.isArray(rows) ? rows[0] : rows

  await sb.from('applications').update({
    payment_status: 'paid',
    paystack_ref: reference,
    paid_at: new Date().toISOString(),
    amount_paid: amount,
    is_submitted: true,
    submitted_at: new Date().toISOString(),
  }).eq('id', applicationId)

  // Complete the registration. Called directly rather than through an internal
  // HTTP request to our own origin — that round trip could time out or fail on
  // its own, leaving a paid application half-processed, and it made the whole
  // flow depend on the deployment being reachable from itself.
  const { completeApplication } = await import('@/lib/registration/complete')
  const completion = await completeApplication(applicationId, reference)

  // ── Registration confirmation SMS (D4) ──
  // Queued, never awaited on the provider: registration is already committed
  // and must not depend on Arkesel being reachable at this instant. The dedupe
  // key means a repeated webhook cannot text the applicant twice.
  const classMode = parseClassMode(app.delivery)
  if (app.phone && classMode) {
    await queueSMS({
      to: app.phone,
      message: SMS.registrationConfirmed(
        String(app.full_name || 'there'),
        course?.name || 'your programme',
        classModeLabel(classMode),
      ),
      kind: 'registration_confirmed',
      entityId: applicationId,
      dedupeKey: `registration_confirmed:${applicationId}`,
    })
  } else if (app.phone && !classMode) {
    // The class mode is missing or unrecognised. Say nothing rather than name
    // the wrong one — that is exactly the defect being fixed.
    console.error('[paystack] application', applicationId, 'has no valid class mode; confirmation SMS withheld')
    await recordAudit({
      action: 'registration.class_mode_missing', resource: 'applications',
      resourceId: applicationId, success: false,
      metadata: { delivery: app.delivery }, request: req,
    })
  }

  await recordAudit({
    action: 'payment.registration_recorded', resource: 'payments',
    resourceId: applicationId, success: true,
    metadata: { reference, amount, wasNew: payment?.was_new !== false }, request: req,
  })

  return NextResponse.json({
    success: true,
    completed: completion.ok,
    admissionNumber: completion.admissionNumber ?? null,
  })
}

/** Course fee paid from the student portal. */
async function handleCourseFeePayment(
  sb: SB, leadId: string, reference: string,
  amount: number, event: PaystackEvent, req: NextRequest
) {
  const { data: rows, error: payErr } = await sb.rpc('record_payment_once', {
    p_reference: reference,
    p_amount: amount,
    p_method: 'paystack',
    p_purpose: 'course_fee',
    p_application: null,
    p_student: null,
    p_response: event.data ?? null,
  })
  if (payErr) throw new Error(payErr.message)

  const payment = Array.isArray(rows) ? rows[0] : rows
  if (payment?.was_new === false) {
    return NextResponse.json({ received: true, note: 'payment already recorded' })
  }

  // Atomic increment: the balance arithmetic happens inside the UPDATE, so two
  // payments landing together cannot overwrite one another's total.
  const { data: feeRows, error: feeErr } = await sb.rpc('apply_fee_payment', {
    p_lead: leadId, p_amount: amount,
  })
  if (feeErr) {
    console.error('[paystack] apply_fee_payment failed:', feeErr.message)
    throw new Error(feeErr.message)
  }

  const fee = Array.isArray(feeRows) ? feeRows[0] : feeRows
  if (!fee) {
    return NextResponse.json({ received: true, note: 'no fee ledger for this student' })
  }

  const { data: lead } = await sb.from('leads')
    .select('full_name, phone').eq('id', leadId).maybeSingle()

  try { await releaseMaterialsFor(leadId) } catch (e) { console.error('[paystack] material release:', e) }

  if (lead?.phone) {
    const balance = Number(fee.balance || 0)
    const msg = balance > 0
      ? `CCE: Payment of GHS ${amount.toFixed(2)} received, thank you. Your outstanding balance is GHS ${balance.toFixed(2)}.`
      : `CCE: Payment of GHS ${amount.toFixed(2)} received, thank you. Your fees are now fully paid.`

    let waOk = false
    try { waOk = Boolean(await sendWhatsAppText(lead.phone, msg)) } catch { /* fall through to SMS */ }
    if (!waOk) {
      await queueSMS({
        to: lead.phone, message: msg,
        kind: 'course_fee_receipt', entityId: leadId,
        dedupeKey: `course_fee_receipt:${reference}`,
      })
    }
  }

  await recordAudit({
    action: 'payment.course_fee_recorded', resource: 'payments',
    resourceId: leadId, success: true,
    metadata: { reference, amount, balance: fee.balance }, request: req,
  })

  return NextResponse.json({ success: true, balance: fee.balance })
}

import { CONFIG } from '@/lib/config'
import { NextRequest, NextResponse } from 'next/server'
import { releaseMaterialsFor } from '@/lib/materialRelease'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { createServiceClient } from '@/lib/supabase/server'
import { onPaymentConfirmed } from '@/lib/notifications'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  const body = await req.text()

  // Verify signature
  const hash = crypto
    .createHmac('sha512', CONFIG.paystackSecretKey)
    .update(body)
    .digest('hex')

  if (hash !== req.headers.get('x-paystack-signature')) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(body)
  if (event.event !== 'charge.success') return NextResponse.json({ received: true })

  const ref = event.data.reference
  const amountGHS = (event.data.amount / 100).toFixed(2)
  const sb = createServiceClient()

  // Check if this is an application payment
  if (ref.startsWith('CCE-APP-') || event.data?.metadata?.application_id) {
    // The application ID is a UUID (contains dashes), so we CANNOT reliably
    // pull it out of the reference by splitting on '-'. Read it from the
    // Paystack metadata (set at init); fall back to stripping the known
    // prefix/suffix off the reference.
    let applicationId = event.data?.metadata?.application_id || null
    if (!applicationId && ref.startsWith('CCE-APP-')) {
      // ref = CCE-APP-{uuid}-{timestamp}; remove prefix + trailing -timestamp
      const withoutPrefix = ref.slice('CCE-APP-'.length)
      applicationId = withoutPrefix.replace(/-\d+$/, '')
    }
    if (!applicationId) return NextResponse.json({ received: true, note: 'no application id' })

    const { data: app } = await sb.from('applications').select('*, course:course_id(name)').eq('id', applicationId).maybeSingle()
    if (!app) return NextResponse.json({ received: true, note: 'application not found' })

    // Was the whole flow already completed (letter sent)? Only skip then.
    // Previously we skipped whenever payment_status was 'paid' — but the
    // browser path sets that BEFORE completing, so if its completion call
    // failed the student got a receipt and never an admission letter.
    let alreadyDone = false
    if (app.lead_id) {
      const { data: adm } = await sb.from('admissions')
        .select('admission_letter_sent').eq('lead_id', app.lead_id).maybeSingle()
      alreadyDone = (adm as any)?.admission_letter_sent === true
    }
    if (alreadyDone) return NextResponse.json({ received: true, note: 'already processed' })

    await sb.from('applications').update({
      payment_status: 'paid',
      paystack_ref: ref,
      paid_at: new Date().toISOString(),
      amount_paid: parseFloat(amountGHS),
      is_submitted: true,
      submitted_at: new Date().toISOString(),
    }).eq('id', applicationId)

    // Record payment
    const { data: payment } = await sb.from('payments').insert({
      application_id: applicationId,
      amount: parseFloat(amountGHS),
      method: 'paystack',
      purpose: 'registration',
      reference: ref,
      status: 'paid',
      paystack_ref: ref,
      paystack_response: event.data,
      paid_at: new Date().toISOString(),
    }).select().single()

    // Complete registration — credits the marketer points + GHS 200
    // commission, marks the lead registered, creates the admission.
    // This is the reliable server-side path (fires even if the student
    // closed their browser before the client callback ran).
    const origin = new URL(req.url).origin
    let completed = false
    try {
      const r = await fetch(`${origin}/api/applications/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, paystack_ref: ref }),
      })
      completed = r.ok
      if (!r.ok) console.error('[paystack webhook] complete failed', r.status, await r.text().catch(() => ''))
    } catch (e: any) {
      console.error('[paystack webhook] complete threw', e?.message)
    }

    // Notify student
    const student = {
      full_name: app.full_name,
      email: app.email,
      phone: app.phone,
    }
    await onPaymentConfirmed(student, amountGHS, payment?.receipt_number || ref, (app as any).course?.name || 'your program')

    return NextResponse.json({ success: true, completed })
  }

  // ── Course fee paid from the student portal ──
  // These were falling through every handler, so the money arrived at Paystack
  // but was never recorded against the student's fees or shown to finance.
  if (ref.startsWith('CCE-STU-') || event.data?.metadata?.purpose === 'course_fee') {
    const leadId = event.data?.metadata?.lead_id
      || (ref.startsWith('CCE-STU-') ? ref.slice('CCE-STU-'.length).replace(/-\d+$/, '') : null)
    if (!leadId) return NextResponse.json({ received: true, note: 'no lead on course fee' })

    const amt = parseFloat(amountGHS)

    // Don't double-count if Paystack retries the webhook
    const { data: seen } = await sb.from('payments')
      .select('id').eq('reference', ref).maybeSingle()
    if (seen) return NextResponse.json({ received: true, note: 'already recorded' })

    const { data: fee } = await sb.from('student_fees')
      .select('id, student_name, phone, course_name, total_fee, amount_paid, lead_id')
      .eq('lead_id', leadId).maybeSingle()

    if (fee) {
      const newPaid = Number(fee.amount_paid || 0) + amt
      const newBalance = Math.max(0, Number(fee.total_fee || 0) - newPaid)
      await sb.from('student_fees').update({
        amount_paid: newPaid, balance: newBalance,
        status: newBalance <= 0 ? 'paid' : 'partial',
        updated_at: new Date().toISOString(),
      }).eq('id', fee.id)

      // Keep the class record in step, so the join-class gate sees the payment
      await sb.from('class_enrollments').update({
        amount_paid: newPaid, balance: newBalance,
      }).eq('lead_id', leadId).then(() => {}, () => {})
    }

    // Record it as a COURSE FEE, so finance sees what it actually is
    const receipt = `RCP-${Date.now().toString().slice(-6)}`
    await sb.from('payments').insert({
      lead_id: leadId,
      amount: amt,
      method: 'paystack',
      purpose: 'course_fee',
      reference: ref,
      receipt_number: receipt,
      status: 'paid',
    }).then(() => {}, () => {})

    // Release any materials this payment now qualifies them for
    try { await releaseMaterialsFor(leadId) } catch {}

    // Tell the student, and tell finance
    if (fee?.phone) {
      const first = (fee.student_name || 'there').split(' ')[0]
      const bal = Math.max(0, Number(fee.total_fee || 0) - (Number(fee.amount_paid || 0) + amt))
      const msg = `Hi ${first}, we've received your payment of GHS ${amt.toFixed(2)} for ${fee.course_name || 'your course'}. Receipt ${receipt}.${bal > 0 ? ` Balance left: GHS ${bal.toFixed(2)}.` : ' You are fully paid, thank you.'}`
      try { await sendWhatsAppText(fee.phone, msg) } catch {}
    }
    try {
      const { data: finance } = await sb.from('profiles')
        .select('id').eq('is_active', true).in('role', ['accountant', 'administrator']).limit(10)
      for (const f of finance || []) {
        await sb.from('notifications').insert({
          user_id: f.id, type: 'payment',
          title: 'Course fee paid',
          body: `${fee?.student_name || 'A student'} paid GHS ${amt.toFixed(2)} through the portal. Receipt ${receipt}.`,
          link: '/finance',
        }).then(() => {}, () => {})
      }
    } catch {}

    return NextResponse.json({ success: true, purpose: 'course_fee', receipt })
  }

  // Check if this is an invoice payment
  const { data: invoice } = await sb.from('invoices').select('*, student:student_id(*)').eq('id', ref).maybeSingle()
  if (invoice) {
    const newPaid = Number(invoice.amount_paid) + parseFloat(amountGHS)
    await sb.from('invoices').update({ amount_paid: newPaid }).eq('id', ref)

    const { data: payment } = await sb.from('payments').insert({
      invoice_id: ref,
      student_id: invoice.student_id,
      amount: parseFloat(amountGHS),
      method: 'paystack',
      status: 'paid',
      paystack_ref: ref,
      paystack_response: event.data,
      paid_at: new Date().toISOString(),
    }).select().single()

    if ((invoice as any).student) {
      await onPaymentConfirmed((invoice as any).student, amountGHS, payment?.receipt_number || ref, 'Course Fee')
    }
  }

  return NextResponse.json({ received: true })
}

import { CONFIG } from '@/lib/config'
import { NextRequest, NextResponse } from 'next/server'
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
  if (ref.startsWith('CCE-APP-')) {
    const parts = ref.split('-')
    const applicationId = parts[2]

    const { data: app } = await sb.from('applications').select('*, course:course_id(name)').eq('id', applicationId).single()
    if (!app) return NextResponse.json({ received: true })

    // Already processed?
    if (app.payment_status === 'paid') return NextResponse.json({ received: true, note: 'already processed' })

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
      status: 'paid',
      paystack_ref: ref,
      paystack_response: event.data,
      paid_at: new Date().toISOString(),
    }).select().single()

    // Create admission case
    await fetch(`${CONFIG.appUrl}/api/admissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: app.lead_id, applicationId }),
    })

    // Notify student
    const student = {
      full_name: app.full_name,
      email: app.email,
      phone: app.phone,
    }
    await onPaymentConfirmed(student, amountGHS, payment?.receipt_number || ref, (app as any).course?.name || 'your program')

    return NextResponse.json({ success: true })
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

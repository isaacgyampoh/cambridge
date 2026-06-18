import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

/**
 * PUBLIC — a student pays their course fee (from the apply flow or a link).
 * Body: { studentFeeId, amount, method, paystackRef?, screenshotUrl? }
 *  - momo (Paystack): verified instantly -> balance reduced + receipt sent.
 *  - bank/cash: recorded PENDING -> finance verifies on the finance page.
 */
function receiptNo() {
  return `CCE/RCT/${new Date().getFullYear()}/${String(Math.floor(10000 + Math.random() * 90000))}`
}

// PUBLIC — look up a student's fee by application (for the apply pay flow)
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const applicationId = url.searchParams.get('applicationId')
  if (!applicationId) return NextResponse.json({ error: 'Missing application' }, { status: 400 })
  const sb = createServiceClient()
  const { data: fee } = await sb.from('student_fees')
    .select('id, student_name, course_name, total_fee, amount_paid, balance, status, phone')
    .eq('application_id', applicationId).maybeSingle()
  if (!fee) return NextResponse.json({ found: false })
  return NextResponse.json({ found: true, fee })
}

export async function POST(req: NextRequest) {
  const { studentFeeId, amount, method, paystackRef, screenshotUrl } = await req.json()
  if (!studentFeeId || !amount || !method) return NextResponse.json({ error: 'Missing details' }, { status: 400 })
  const amt = Number(amount)
  if (!(amt > 0)) return NextResponse.json({ error: 'Enter a valid amount' }, { status: 400 })

  const sb = createServiceClient()
  const { data: fee } = await sb.from('student_fees').select('*').eq('id', studentFeeId).maybeSingle()
  if (!fee) return NextResponse.json({ error: 'Fee record not found' }, { status: 404 })

  const rcpt = receiptNo()
  const verified = method === 'momo'

  await sb.from('fee_payments').insert({
    student_fee_id: fee.id, application_id: fee.application_id,
    student_name: fee.student_name, phone: fee.phone,
    amount: amt, method, status: verified ? 'verified' : 'pending',
    paystack_ref: paystackRef || null, screenshot_url: screenshotUrl || null,
    receipt_no: rcpt, verified_at: verified ? new Date().toISOString() : null,
  })

  let newBalance = Number(fee.balance) || 0
  if (verified) {
    const newPaid = (Number(fee.amount_paid) || 0) + amt
    newBalance = Math.max(0, (Number(fee.total_fee) || 0) - newPaid)
    await sb.from('student_fees').update({
      amount_paid: newPaid, balance: newBalance,
      status: newBalance <= 0 ? 'paid' : 'partial', updated_at: new Date().toISOString(),
    }).eq('id', fee.id)

    const first = (fee.student_name || '').split(' ')[0] || 'there'
    const msg = `Hello ${first}, we've received your payment of GHS ${amt.toFixed(2)}. Receipt: ${rcpt}.${newBalance > 0 ? ` Your remaining balance is GHS ${newBalance.toFixed(2)}.` : ' Your fees are fully paid — thank you!'}`
    if (fee.phone) { try { await sendWhatsAppText(fee.phone, msg) } catch { try { await sendSMS(fee.phone, msg) } catch {} } }
  }

  return NextResponse.json({
    success: true, verified, receiptNo: rcpt, amount: amt, balance: newBalance,
    message: verified ? 'Payment received' : (method === 'bank' ? 'Submitted — finance will verify your transfer' : 'Recorded — please pay at the desk'),
  })
}

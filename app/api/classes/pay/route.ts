import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

/**
 * PUBLIC — records a class payment made at sign-in.
 * Body: { enrollmentId, amount, method, paystackRef?, screenshotUrl? }
 *  - momo (Paystack): verified immediately, balance reduced, invoice sent.
 *  - bank: recorded as PENDING (accountant verifies later) with screenshot.
 *  - cash: recorded as PENDING (student pays at the desk).
 * Returns invoice info + new balance.
 */
function invoiceNo() {
  return `CCE/INV/${new Date().getFullYear()}/${String(Math.floor(10000 + Math.random() * 90000))}`
}

export async function POST(req: NextRequest) {
  const { enrollmentId, amount, method, paystackRef, screenshotUrl } = await req.json()
  if (!enrollmentId || !amount || !method) return NextResponse.json({ error: 'Missing details' }, { status: 400 })
  const amt = Number(amount)
  if (!(amt > 0)) return NextResponse.json({ error: 'Enter a valid amount' }, { status: 400 })

  const sb = createServiceClient()
  const { data: enr } = await sb.from('class_enrollments')
    .select('id, batch_id, full_name, phone, total_fee, amount_paid, balance').eq('id', enrollmentId).maybeSingle()
  if (!enr) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

  const inv = invoiceNo()
  // momo via Paystack is confirmed at the point of payment; bank/cash are pending
  const verified = method === 'momo'

  await sb.from('class_payments').insert({
    batch_id: enr.batch_id, enrollment_id: enr.id,
    student_name: enr.full_name, phone: enr.phone,
    amount: amt, method, status: verified ? 'verified' : 'pending',
    paystack_ref: paystackRef || null, screenshot_url: screenshotUrl || null,
    invoice_no: inv, verified_at: verified ? new Date().toISOString() : null,
  })

  let newBalance = Number(enr.balance ?? ((enr.total_fee || 0) - (enr.amount_paid || 0))) || 0

  // Only verified (MoMo) payments reduce the balance now. Bank/cash reduce
  // it when the accountant verifies.
  if (verified) {
    const newPaid = (Number(enr.amount_paid) || 0) + amt
    newBalance = Math.max(0, (Number(enr.total_fee) || 0) - newPaid)
    await sb.from('class_enrollments').update({
      amount_paid: newPaid, balance: newBalance,
      fees_paid: newBalance <= 0,
    }).eq('id', enr.id)

    // Send invoice + balance notification
    const first = (enr.full_name || '').split(' ')[0] || 'there'
    const msg = `Hello ${first}, we've received your payment of GHS ${amt.toFixed(2)}. Invoice: ${inv}.${newBalance > 0 ? ` Your remaining balance is GHS ${newBalance.toFixed(2)}.` : ' Your fees are fully paid — thank you!'} Enjoy your class.`
    if (enr.phone) { try { await sendWhatsAppText(enr.phone, msg) } catch { try { await sendSMS(enr.phone, msg) } catch {} } }
  }

  return NextResponse.json({
    success: true, verified, invoiceNo: inv, amount: amt,
    balance: newBalance,
    message: verified ? 'Payment received' : (method === 'bank' ? 'Submitted for verification' : 'Recorded — please pay at the desk'),
  })
}

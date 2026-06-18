import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

/**
 * Finance verifies (or rejects) a pending fee payment (bank/cash).
 * On verify, finance confirms the actual amount (full or partial); the
 * student's balance updates and they get a receipt + balance notification.
 * GET  — pending + recent payments.
 * POST — { paymentId, action: 'verify'|'reject', amount? }
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !['super_admin', 'project_manager', 'accountant'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const sb = createServiceClient()
  const { data } = await sb.from('fee_payments')
    .select('*, fee:student_fee_id(student_name, course_name, total_fee, amount_paid, balance)')
    .order('created_at', { ascending: false }).limit(200)
  return NextResponse.json({ payments: data || [] })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '', userId: '' }
  if (!session.valid || !['super_admin', 'project_manager', 'accountant'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const { paymentId, action, amount } = await req.json()
  const sb = createServiceClient()

  const { data: pay } = await sb.from('fee_payments').select('*').eq('id', paymentId).maybeSingle()
  if (!pay || pay.status !== 'pending') return NextResponse.json({ error: 'Payment not found or already handled' }, { status: 400 })

  if (action === 'reject') {
    await sb.from('fee_payments').update({ status: 'rejected', verified_by: session.userId, verified_at: new Date().toISOString() }).eq('id', paymentId)
    return NextResponse.json({ success: true })
  }

  const confirmed = Number(amount ?? pay.amount)
  const { data: fee } = await sb.from('student_fees').select('*').eq('id', pay.student_fee_id).maybeSingle()
  if (!fee) return NextResponse.json({ error: 'Fee record not found' }, { status: 404 })

  const newPaid = (Number(fee.amount_paid) || 0) + confirmed
  const newBalance = Math.max(0, (Number(fee.total_fee) || 0) - newPaid)
  await sb.from('student_fees').update({
    amount_paid: newPaid, balance: newBalance,
    status: newBalance <= 0 ? 'paid' : 'partial', updated_at: new Date().toISOString(),
  }).eq('id', fee.id)
  await sb.from('fee_payments').update({ status: 'verified', amount: confirmed, verified_by: session.userId, verified_at: new Date().toISOString() }).eq('id', paymentId)

  const first = (fee.student_name || '').split(' ')[0] || 'there'
  const msg = `Hello ${first}, your payment of GHS ${confirmed.toFixed(2)} has been confirmed. Receipt: ${pay.receipt_no}.${newBalance > 0 ? ` Remaining balance: GHS ${newBalance.toFixed(2)}.` : ' Your fees are fully paid — thank you!'}`
  if (fee.phone) { try { await sendWhatsAppText(fee.phone, msg) } catch { try { await sendSMS(fee.phone, msg) } catch {} } }

  return NextResponse.json({ success: true, balance: newBalance })
}

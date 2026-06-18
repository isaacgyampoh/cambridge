import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

/**
 * Accountant verifies (or rejects) a pending class payment (bank/cash).
 * On verify, the actual amount is applied to the student's balance (can be
 * full or partial) and an invoice/balance notification is sent.
 * GET  — list pending payments.
 * POST — { paymentId, action: 'verify'|'reject', amount? }
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !['super_admin', 'project_manager', 'accountant'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const sb = createServiceClient()
  const { data } = await sb.from('class_payments')
    .select('*, batch:batch_id(name), enrollment:enrollment_id(full_name, total_fee, amount_paid, balance)')
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

  const { data: pay } = await sb.from('class_payments').select('*').eq('id', paymentId).maybeSingle()
  if (!pay || pay.status !== 'pending') return NextResponse.json({ error: 'Payment not found or already handled' }, { status: 400 })

  if (action === 'reject') {
    await sb.from('class_payments').update({ status: 'rejected', verified_by: session.userId, verified_at: new Date().toISOString() }).eq('id', paymentId)
    return NextResponse.json({ success: true })
  }

  // verify — apply the confirmed amount (accountant may adjust for partial)
  const confirmed = Number(amount ?? pay.amount)
  const { data: enr } = await sb.from('class_enrollments').select('*').eq('id', pay.enrollment_id).maybeSingle()
  if (!enr) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

  const newPaid = (Number(enr.amount_paid) || 0) + confirmed
  const newBalance = Math.max(0, (Number(enr.total_fee) || 0) - newPaid)
  await sb.from('class_enrollments').update({ amount_paid: newPaid, balance: newBalance, fees_paid: newBalance <= 0 }).eq('id', enr.id)
  await sb.from('class_payments').update({ status: 'verified', amount: confirmed, verified_by: session.userId, verified_at: new Date().toISOString() }).eq('id', paymentId)

  // Invoice + balance notification
  const first = (enr.full_name || '').split(' ')[0] || 'there'
  const msg = `Hello ${first}, your payment of GHS ${confirmed.toFixed(2)} has been confirmed. Invoice: ${pay.invoice_no}.${newBalance > 0 ? ` Remaining balance: GHS ${newBalance.toFixed(2)}.` : ' Your fees are fully paid — thank you!'} Enjoy your class.`
  if (enr.phone) { try { await sendWhatsAppText(enr.phone, msg) } catch { try { await sendSMS(enr.phone, msg) } catch {} } }

  return NextResponse.json({ success: true, balance: newBalance })
}

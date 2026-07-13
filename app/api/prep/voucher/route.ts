import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'exam_coordinator']

/**
 * Enter a voucher code for a student (one per student, when they're ready).
 * On save, the system auto-messages the student their voucher + expiry +
 * encouragement on WhatsApp (SMS fallback).
 * Body: { prep_record_id, voucher_code, voucher_expiry_date }
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { prep_record_id, voucher_code, voucher_expiry_date } = await req.json()
  if (!prep_record_id || !voucher_code?.trim()) {
    return NextResponse.json({ error: 'Voucher code is required.' }, { status: 400 })
  }

  const sb = createServiceClient()
  const { data: rec } = await sb.from('prep_records').select('*').eq('id', prep_record_id).maybeSingle()
  if (!rec) return NextResponse.json({ error: 'Student not found.' }, { status: 404 })

  await sb.from('prep_records').update({
    voucher_code: voucher_code.trim(),
    voucher_expiry_date: voucher_expiry_date || null,
    voucher_sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', prep_record_id)

  // Auto-message the student
  let sent = false
  if (rec.phone) {
    const first = (rec.student_name || 'there').split(' ')[0]
    const expiry = voucher_expiry_date ? new Date(voucher_expiry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null
    const msg = `Hi ${first}! 🎓 Here is your ${rec.program_name || rec.program_code || 'exam'} voucher code:\n\n*${voucher_code.trim()}*\n${expiry ? `\nPlease note it expires on *${expiry}*, so schedule your exam before then.` : ''}\n\nWe'll keep sending you tips and reminders to prepare. Do your best — you've got this! 💪`
    try { sent = !!(await sendWhatsAppText(rec.phone, msg)) } catch {}
    if (!sent) { try { sent = !!(await sendSMS(rec.phone, msg)) } catch {} }
  }

  // Log activity
  try {
    await sb.from('prep_activity').insert({
      prep_record_id, coordinator_id: s.userId,
      action: 'voucher_sent', detail: `Voucher ${voucher_code.trim()} sent to ${rec.student_name}`,
    })
  } catch {}

  return NextResponse.json({ success: true, messaged: sent })
}

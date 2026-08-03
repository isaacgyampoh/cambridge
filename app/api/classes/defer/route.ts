import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager', 'accountant', 'admissions_officer', 'trainer']

/**
 * Move a student to a later cohort, carrying everything they have paid.
 * Used when someone has an emergency after paying — they keep their money and
 * their place rather than losing both.
 * Body: { enrollmentId, toBatchId, reason }
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { enrollmentId, toBatchId, reason } = await req.json().catch(() => ({}))
  if (!enrollmentId || !toBatchId) {
    return NextResponse.json({ error: 'Choose the student and the class they are moving to.' }, { status: 400 })
  }

  const sb = createServiceClient()
  const { data: enr } = await sb.from('class_enrollments')
    .select('id, lead_id, batch_id, full_name, phone, total_fee, amount_paid, balance')
    .eq('id', enrollmentId).maybeSingle()
  if (!enr) return NextResponse.json({ error: 'Student not found.' }, { status: 404 })

  const { data: toBatch } = await sb.from('batches')
    .select('id, name, start_date, schedule').eq('id', toBatchId).maybeSingle()
  if (!toBatch) return NextResponse.json({ error: 'That class could not be found.' }, { status: 404 })

  // Move them, keeping what they have paid.
  await sb.from('class_enrollments').update({
    batch_id: toBatchId, updated_at: new Date().toISOString(),
  }).eq('id', enrollmentId)

  // Their attendance belongs to the old cohort — clear it so the payment gate
  // counts sessions from the start of the new one.
  await sb.from('class_signins').delete().eq('enrollment_id', enrollmentId).then(() => {}, () => {})

  await sb.from('deferrals').insert({
    lead_id: enr.lead_id, enrollment_id: enrollmentId,
    from_batch_id: enr.batch_id, to_batch_id: toBatchId,
    reason: reason || null, amount_carried: Number(enr.amount_paid || 0),
    deferred_by: s.userId,
  }).then(() => {}, () => {})

  // Tell the student, plainly.
  if (enr.phone) {
    const first = (enr.full_name || 'there').split(' ')[0]
    const starts = toBatch.start_date
      ? new Date(toBatch.start_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : null
    const msg = `Hi ${first}, we have moved you to ${toBatch.name}${starts ? `, starting ${starts}` : ''}. Everything you have paid so far (GHS ${Number(enr.amount_paid || 0).toFixed(2)}) carries over, so nothing is lost.${toBatch.schedule ? `\n\nSchedule: ${toBatch.schedule}` : ''}\n\nSee you then.`
    let ok = false
    try { ok = !!(await sendWhatsAppText(enr.phone, msg)) } catch {}
    if (!ok) { try { await sendSMS(enr.phone, msg) } catch {} }
  }

  return NextResponse.json({
    success: true,
    movedTo: toBatch.name,
    amountCarried: Number(enr.amount_paid || 0),
  })
}

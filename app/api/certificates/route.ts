import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { sendEmailGeneric } from '@/lib/integrations/email'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

function token(n = 16) {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: n }, () => ch[Math.floor(Math.random() * ch.length)]).join('')
}

/**
 * Issue a certificate to a completed, fully-paid student.
 * Body: { enrollmentId, certificateUrl, monthCompleted, send }
 * Gate: the enrollment must be status=completed AND fees_paid=true.
 */
export async function POST(req: NextRequest) {
  const tk = req.cookies.get('cce_session')?.value
  if (!tk) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(tk)
  if (!session.valid || !['super_admin', 'project_manager', 'admissions_officer'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const { enrollmentId, certificateUrl, monthCompleted, send } = await req.json()
  if (!enrollmentId) return NextResponse.json({ error: 'Missing enrollmentId' }, { status: 400 })

  const sb = createServiceClient()
  const { data: enr } = await sb.from('class_enrollments')
    .select('*, batch:batch_id(name, course:course_id(name))')
    .eq('id', enrollmentId).maybeSingle()
  if (!enr) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 })

  // Gate: must have completed AND paid full school fees
  if (enr.status !== 'completed') return NextResponse.json({ error: 'Student has not completed the class yet' }, { status: 400 })
  if (!enr.fees_paid) return NextResponse.json({ error: 'Full school fees not paid — cannot issue certificate' }, { status: 400 })

  const courseName = (enr as any).batch?.course?.name || 'the programme'
  const dl = token()
  const certNo = `CCE/CERT/${new Date().getFullYear()}/${String(Math.floor(1000 + Math.random() * 9000))}`

  // Upsert the registry row (one per enrollment)
  const { data: existing } = await sb.from('certificates').select('id, download_token').eq('enrollment_id', enrollmentId).maybeSingle()
  let row
  if (existing) {
    const { data } = await sb.from('certificates').update({
      certificate_url: certificateUrl || null,
      month_completed: monthCompleted || null,
      student_name: enr.full_name, course_name: courseName,
      email: enr.email, phone: enr.phone,
    }).eq('id', existing.id).select().maybeSingle()
    row = data
  } else {
    const { data } = await sb.from('certificates').insert({
      enrollment_id: enrollmentId, batch_id: enr.batch_id,
      student_name: enr.full_name, course_name: courseName,
      month_completed: monthCompleted || null, certificate_no: certNo,
      certificate_url: certificateUrl || null, email: enr.email, phone: enr.phone,
      download_token: dl,
    }).select().maybeSingle()
    row = data
  }

  // Optionally send the download link to the student
  let sent = false
  if (send && row) {
    const link = `${CONFIG.appUrl}/certificate/${row.download_token}`
    const first = (enr.full_name || '').split(' ')[0] || 'there'
    const msg = `Congratulations ${first}! Your certificate for ${courseName} at Cambridge Center of Excellence is ready. Download it here: ${link}`
    if (enr.phone) { try { await sendWhatsAppText(enr.phone, msg); sent = true } catch { try { await sendSMS(enr.phone, msg); sent = true } catch {} } }
    if (enr.email) { try { await sendEmailGeneric(enr.email, `Your certificate — ${courseName}`, `<p>Congratulations ${first},</p><p>Your certificate for <strong>${courseName}</strong> is ready.</p><p><a href="${link}">Download your certificate</a></p><p>Cambridge Center of Excellence</p>`); sent = true } catch {} }
    await sb.from('certificates').update({ issued: true, issued_at: new Date().toISOString() }).eq('id', row.id)
  }

  return NextResponse.json({ success: true, certificate: row, sent })
}

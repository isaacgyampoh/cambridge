import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { sendAdmissionLetter } from '@/lib/integrations/email'
import { sendSMS } from '@/lib/integrations/sms'

/**
 * Admit a student. Sets the admission to 'admitted', generates an
 * admission number if missing, and AUTOMATICALLY sends the admission
 * letter by email (+ a short SMS). Body: { admissionId }
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid || !['super_admin', 'admissions_officer', 'project_manager'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const { admissionId } = await req.json()
  if (!admissionId) return NextResponse.json({ error: 'Missing admissionId' }, { status: 400 })

  const sb = createServiceClient()
  const { data: adm } = await sb.from('admissions')
    .select('*, student:student_id(full_name, email, phone), course:course_id(name)')
    .eq('id', admissionId).maybeSingle()
  if (!adm) return NextResponse.json({ error: 'Admission not found' }, { status: 404 })

  // Generate admission number if missing
  const admissionNo = adm.admission_number || `CCE/${new Date().getFullYear()}/${String(Math.floor(1000 + Math.random() * 9000))}`

  await sb.from('admissions').update({
    status: 'admitted',
    admission_number: admissionNo,
    admitted_at: new Date().toISOString(),
    admission_letter_sent: true,
  }).eq('id', admissionId)

  // Resolve student contact — prefer linked student, fall back to application
  let name = adm.student?.full_name, email = adm.student?.email, phone = adm.student?.phone
  const courseName = adm.course?.name || 'your programme'
  if (!email) {
    const { data: app } = await sb.from('applications')
      .select('full_name, email, phone, course:course_id(name)')
      .eq('lead_id', adm.lead_id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (app) { name = name || app.full_name; email = email || app.email; phone = phone || app.phone }
  }

  let emailed = false
  if (email) {
    try { await sendAdmissionLetter(email, name || 'Student', courseName, admissionNo); emailed = true } catch {}
  }
  if (phone) {
    try { await sendSMS(phone, `Congratulations ${(name || '').split(' ')[0]}! You have been admitted to ${courseName} at Cambridge Centre of Excellence. Admission No: ${admissionNo}. Check your email for your admission letter.`) } catch {}
  }

  return NextResponse.json({ success: true, admissionNo, emailed })
}

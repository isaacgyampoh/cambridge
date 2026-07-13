import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateAdmissionPDF } from '@/lib/generateAdmissionPDF'
import { sendWelcomeEmail, sendAdmissionLetter } from '@/lib/integrations/email'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

export const runtime = 'nodejs'

/**
 * Called when a student completes the registration link AND pays the
 * GHS 200 registration fee via Paystack.
 *
 * Because payment = registration, this:
 *  1. Ensures a lead exists (creates/links one)
 *  2. Credits the marketer: programme points + GHS 200 commission
 *  3. Marks the lead 'registered'
 *  4. Creates the admission record + sends the welcome email
 *
 * All point-crediting uses the SAME logic as /api/leads/status so the
 * marketer's rank, salary and commission update identically no matter
 * how the student registered (link payment, pipeline, or manual).
 */

// Map a course name to a programme code for points
function matchProgram(courseName: string | null, programs: any[]): any | null {
  if (!courseName) return null
  const t = courseName.toLowerCase()
  for (const p of programs) {
    if (t.includes(p.code.toLowerCase()) || t.includes(p.name.toLowerCase())) return p
  }
  const map: Record<string, string> = {
    'pmp': 'PMP', 'project management': 'PMP',
    'sphr': 'SPHRI', 'phri': 'SPHRI', 'human resource': 'SPHRI', 'hr': 'SPHRI',
    'aphri': 'APHRI', 'capm': 'CAPM', 'ngo': 'NGO',
    'project financing': 'PROJFIN', 'financing': 'PROJFIN',
    'ms project': 'MSPROJ', 'microsoft project': 'MSPROJ',
    'commercial law': 'COMLAW', 'law': 'COMLAW',
    'instructor': 'INSTR', 'corporate': 'CORP',
  }
  for (const [kw, code] of Object.entries(map)) {
    if (t.includes(kw)) { const p = programs.find(x => x.code === code); if (p) return p }
  }
  return null
}

export async function POST(req: NextRequest) {
  const { applicationId, paystack_ref } = await req.json()
  if (!applicationId) return NextResponse.json({ error: 'Missing applicationId' }, { status: 400 })

  const sb = createServiceClient()

  // Record the payment (service role — bypasses RLS). Marks the application
  // paid + submitted so admission processing can proceed.
  if (paystack_ref) {
    await sb.from('applications').update({
      payment_status: 'paid', paystack_ref,
      paid_at: new Date().toISOString(), amount_paid: 200,
      is_submitted: true, submitted_at: new Date().toISOString(),
    }).eq('id', applicationId)
  }

  const { data: app } = await sb.from('applications').select('*, course:course_id(name)').eq('id', applicationId).single()
  if (!app) return NextResponse.json({ error: 'Application not found' }, { status: 404 })

  const courseName = (app as any).course?.name || null

  // Welcome email
  if (app.email) {
    await sendWelcomeEmail(app.email, app.full_name, courseName || 'your programme')
  }

  // 1. Ensure a lead exists
  let leadId = app.lead_id
  if (!leadId) {
    const { data: lead } = await sb.from('leads').insert({
      full_name: app.full_name,
      email: app.email,
      phone: app.phone,
      source: app.marketer_id ? 'referral' : 'website',
      status: 'new',
      course_interest: courseName,
      assigned_to: app.marketer_id || null,
    }).select().single()
    leadId = lead?.id
    if (leadId) await sb.from('applications').update({ lead_id: leadId }).eq('id', applicationId)
  }

  if (!leadId) return NextResponse.json({ error: 'Could not create lead' }, { status: 500 })

  const { data: lead } = await sb.from('leads').select('*').eq('id', leadId).single()
  const creditTo = app.marketer_id || lead?.assigned_to || null

  // 2. Credit remuneration (only if paid and not already credited)
  if (app.payment_status === 'paid') {
    const { data: already } = await sb.from('marketer_enrollments')
      .select('id').eq('lead_id', leadId).limit(1).maybeSingle()

    if (!already && creditTo) {
      const { data: programs } = await sb.from('program_points').select('*').eq('is_active', true)
      const prog = matchProgram(courseName, programs || [])
      if (prog) {
        let points = Number(prog.points || 0)
        if (prog.is_corporate) points = 40
        await sb.from('marketer_enrollments').insert({
          marketer_id: creditTo, lead_id: leadId,
          program_code: prog.code, program_name: prog.name,
          points, registration_fee: 200, delivery: app.delivery || 'in_person',
          is_pipeline: false, year: new Date().getFullYear(),
        })
        await sb.from('notifications').insert({
          user_id: creditTo, type: 'points',
          title: `+${points} points earned`,
          body: `${app.full_name} registered and paid for ${prog.name}. ${points} points + GHS 200 registration added to your annual total.`,
          link: '/marketer/earnings',
        })
      }
    }

    // 3. Mark registered (payment = registration)
    await sb.from('leads').update({ status: 'registered' }).eq('id', leadId)
    await sb.from('lead_activities').insert({
      lead_id: leadId, activity_type: 'note', subject: 'Registered via link',
      description: `Paid GHS 200 registration for ${courseName || 'programme'} through the registration link.`,
    })
  } else {
    // Not paid yet — just move toward ready_to_join
    if (lead && lead.status !== 'ready_to_join') {
      await sb.from('leads').update({ status: 'ready_to_join' }).eq('id', leadId)
    }
  }

  // 4. Admission record (idempotent — don't duplicate)
  let admissionNo = ''
  const { data: existingAdm } = await sb.from('admissions').select('id, admission_number').eq('lead_id', leadId).maybeSingle()
  if (!existingAdm) {
    admissionNo = `CCE/${new Date().getFullYear()}/${String(Math.floor(1000 + Math.random() * 9000))}`
    const { data: admission } = await sb.from('admissions').insert({
      lead_id: leadId,
      course_id: app.course_id,
      admission_number: admissionNo,
      status: app.payment_status === 'paid' ? 'awaiting_forms' : 'pending',
    }).select().single()
    if (admission) {
      await sb.from('applications').update({ admission_id: admission.id }).eq('id', applicationId)
    }
  } else {
    admissionNo = existingAdm.admission_number || ''
  }

  // 5. AUTO admission letter — a personalized PDF (name, admission no,
  // programme, start date) generated on the fly, saved to Supabase, and sent
  // on BOTH WhatsApp and email. No manual admin step.
  if (app.phone || app.email) {
    const letterCourse = (app as any).course?.name || 'your programme'
    const first = (app.full_name || '').split(' ')[0] || 'there'

    let startDate: string | undefined
    try {
      const { data: batch } = await sb.from('batches')
        .select('start_date').eq('course_id', app.course_id).order('start_date', { ascending: true }).limit(1).maybeSingle()
      if (batch?.start_date) startDate = new Date(batch.start_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    } catch {}

    // Find the admission-letter document for THIS programme (uploaded in the
    // Documents area). Prefer a course-specific one; fall back to a general
    // admission letter; finally fall back to an auto-generated PDF.
    let letterUrl: string | null = null
    try {
      const { data: courseDoc } = await sb.from('documents')
        .select('file_url').eq('type', 'admission_letter').eq('course_id', app.course_id).eq('is_active', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      letterUrl = courseDoc?.file_url || null
      if (!letterUrl) {
        const { data: generalDoc } = await sb.from('documents')
          .select('file_url').eq('type', 'admission_letter').is('course_id', null).eq('is_active', true)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        letterUrl = generalDoc?.file_url || null
      }
    } catch {}
    if (!letterUrl) {
      letterUrl = await generateAdmissionPDF({
        name: app.full_name || 'Student', course: letterCourse,
        admissionNo: admissionNo || '', startDate, delivery: app.delivery,
      })
    }

    const letterLine = letterUrl ? `\n\nYour admission letter:\n${letterUrl}` : ''
    const msg = `Dear ${first}, congratulations! 🎉 You have been admitted to ${letterCourse} at Cambridge Centre of Excellence.${admissionNo ? ` Your admission number is ${admissionNo}.` : ''}${letterLine}\n\nWelcome aboard.`

    if (app.phone) {
      let waOk = false
      try { waOk = !!(await sendWhatsAppText(app.phone, msg)) } catch {}
      if (!waOk) { try { await sendSMS(app.phone, msg) } catch {} }
    }
    if (app.email) {
      try { await sendAdmissionLetter(app.email, app.full_name || 'Student', letterCourse, admissionNo, startDate, letterUrl || undefined) } catch {}
    }
    await sb.from('admissions').update({ admission_letter_sent: true, admitted_at: new Date().toISOString() }).eq('lead_id', leadId).then(() => {}, () => {})
  }

  // 6. STUDENT FEES — create the fee ledger so the student appears on the
  // finance page with their course fee owed. Idempotent per application.
  try {
    const { data: existingFee } = await sb.from('student_fees').select('id').eq('application_id', applicationId).maybeSingle()
    if (!existingFee) {
      // Course fee from the course record (the total school fee)
      let totalFee = 0, courseName = (app as any).course?.name || null
      if (app.course_id) {
        const { data: course } = await sb.from('courses').select('name, course_fee, course_fee_online').eq('id', app.course_id).maybeSingle()
        if (course) {
          courseName = course.name
          // Online students pay the online fee where one is set; otherwise the standard fee
          const isOnline = (app.delivery || 'in_person') === 'online'
          const onlineFee = Number(course.course_fee_online) || 0
          totalFee = isOnline && onlineFee > 0 ? onlineFee : (Number(course.course_fee) || 0)
        }
      }
      await sb.from('student_fees').insert({
        application_id: applicationId, lead_id: leadId,
        student_name: app.full_name, email: app.email, phone: app.phone,
        course_id: app.course_id, course_name: courseName,
        delivery: app.delivery || 'in_person',
        total_fee: totalFee, amount_paid: 0, balance: totalFee,
        status: totalFee > 0 ? 'owing' : 'paid',
      })
    }
  } catch { /* fee ledger optional — never block registration */ }

  // ── Auto-enrol into the exam-prep pipeline ──────────────────────────
  // If the student registered for an exam-prep programme (PMP / PHRi / SPHRi),
  // create their prep record so the coordinator starts prepping them
  // automatically. Matched to the coordinator via program_code.
  try {
    const cName = ((app as any).course?.name || '').toLowerCase()
    let progCode: string | null = null, progName: string | null = null
    if (cName.includes('pmp') || cName.includes('project management')) { progCode = 'PMP'; progName = 'PMP' }
    else if (cName.includes('sphri') || cName.includes('senior professional')) { progCode = 'SPHRI'; progName = 'SPHRi' }
    else if (cName.includes('phri') || cName.includes('professional in human')) { progCode = 'PHRI'; progName = 'PHRi' }

    if (progCode) {
      const { data: existingPrep } = await sb.from('prep_records').select('id').eq('lead_id', leadId).maybeSingle()
      if (!existingPrep) {
        // Match the coordinator who runs this programme
        const { data: coord } = await sb.from('profiles').select('id')
          .eq('role', 'exam_coordinator').eq('coordinator_program', progCode).maybeSingle()
        await sb.from('prep_records').insert({
          lead_id: leadId, application_id: applicationId,
          student_name: app.full_name, email: app.email, phone: app.phone,
          program_code: progCode, program_name: progName,
          coordinator_id: coord?.id || null,
          prep_status: 'ongoing',
        })
      }
    }
  } catch { /* prep enrolment optional — never block registration */ }

  return NextResponse.json({ success: true, credited: app.payment_status === 'paid' })
}

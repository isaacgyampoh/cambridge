import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { renderPersonalisedDoc } from '@/lib/documentFill'

export const runtime = 'nodejs'
export const maxDuration = 60
const ALLOWED = ['super_admin', 'administrator', 'project_manager', 'trainer', 'admissions_officer']

/**
 * Issue certificates for a class from the uploaded template, personalised with
 * each student's own name and certificate number.
 * Body: { batchId, studentIds? }  — omit studentIds to do the whole class.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { batchId, studentIds } = await req.json().catch(() => ({}))
  if (!batchId) return NextResponse.json({ error: 'Choose a class.' }, { status: 400 })

  const sb = createServiceClient()
  const { data: batch } = await sb.from('batches')
    .select('id, name, course_id, courses(name)').eq('id', batchId).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Class not found.' }, { status: 404 })

  // The template you uploaded, for this course if there is one
  const pick = async (courseScoped: boolean) => {
    let q = sb.from('documents').select('file_url, field_positions, is_template').eq('type', 'certificate')
    q = courseScoped ? q.eq('course_id', batch.course_id) : q.is('course_id', null)
    const { data } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()
    return data
  }
  const template: any = (await pick(true)) || (await pick(false))
  if (!template?.file_url) {
    return NextResponse.json({ error: 'Upload a certificate template first, in Documents.' }, { status: 400 })
  }

  let q = sb.from('class_enrollments')
    .select('id, lead_id, full_name, total_fee, amount_paid').eq('batch_id', batchId)
  if (Array.isArray(studentIds) && studentIds.length) q = q.in('id', studentIds)
  const { data: roster } = await q.limit(500)

  const courseName = (batch as any)?.courses?.name || batch.name
  const issued: string[] = []
  const skipped: string[] = []

  for (const st of roster || []) {
    // Only for students who have finished paying
    if (Number(st.amount_paid || 0) < Number(st.total_fee || 0)) { skipped.push(st.full_name); continue }

    const { data: existing } = await sb.from('certificates')
      .select('id').eq('lead_id', st.lead_id).eq('course_name', courseName).maybeSingle()
    if (existing) { continue }

    const certNo = `CCE/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 9000) + 1000)}`
    const url = await renderPersonalisedDoc({
      templateUrl: template.file_url,
      positions: template.field_positions || null,
      folder: 'certificates',
      filename: st.full_name,
      values: {
        full_name: st.full_name || '',
        course: courseName,
        batch: batch.name || '',
        date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
        admission_number: certNo,
        receipt_number: '', amount: '', email: '', phone: '',
      },
    })
    if (!url) { skipped.push(st.full_name); continue }

    await sb.from('certificates').insert({
      lead_id: st.lead_id, student_name: st.full_name,
      course_name: courseName, certificate_number: certNo,
      final_url: url, issued_date: new Date().toISOString(),
    }).then(() => {}, () => {})
    issued.push(st.full_name)
  }

  return NextResponse.json({ success: true, issued: issued.length, skipped: skipped.length, skippedNames: skipped.slice(0, 10) })
}

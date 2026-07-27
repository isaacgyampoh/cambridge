import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyStudent, STUDENT_COOKIE } from '@/lib/student/auth'

export const runtime = 'nodejs'

/** Record that the student joined today's class from the portal. */
export async function POST(req: NextRequest) {
  const s = await verifyStudent(req.cookies.get(STUDENT_COOKIE)?.value)
  if (!s) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { data: enr } = await sb.from('class_enrollments')
    .select('id, batch_id, full_name, phone').eq('lead_id', s.leadId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!enr) return NextResponse.json({ error: 'No class found' }, { status: 404 })

  const today = new Date().toISOString().slice(0, 10)
  const { data: existing } = await sb.from('class_signins')
    .select('id').eq('enrollment_id', enr.id).eq('session_date', today).maybeSingle()
  if (!existing) {
    await sb.from('class_signins').insert({
      batch_id: enr.batch_id, enrollment_id: enr.id,
      student_name: enr.full_name, phone: enr.phone, session_date: today,
    })
  }
  return NextResponse.json({ success: true })
}

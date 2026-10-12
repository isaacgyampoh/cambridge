import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { onClassReminder } from '@/lib/notifications'
import { formatDate } from '@/lib/utils'
import { verifySession } from '@/lib/auth/pin'
import { lookup, unavailable } from '@/lib/db/lookup'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !['super_admin', 'project_manager', 'trainer', 'receptionist'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const { batchId, type } = await req.json()
  if (!batchId || !type) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  const sb = createServiceClient()

  // maybeSingle, not single: single() reports "no rows" as an error, which
  // would make a missing batch indistinguishable from a failed read.
  const { row: batch, failed } = await lookup(
    sb.from('batches').select('*, courses(*)').eq('id', batchId).maybeSingle(),
  )
  if (failed) return unavailable('[reminders]', failed, 'that class')
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  // Get all enrolled students
  /*
   * The roster that is actually written.
   *
   * batch_students has no writer anywhere in this codebase, so this returned
   * nothing and the route answered "No students enrolled" — which reads as a
   * class nobody joined rather than a reminder system that cannot see
   * anybody. class_enrollments carries the name, number and email inline, so
   * there is no join: a student here is a lead, not a member of staff.
   */
  const { data: enrollments } = await sb.from('class_enrollments')
    .select('id, lead_id, full_name, phone, email')
    .eq('batch_id', batchId).eq('status', 'active')

  if (!enrollments?.length) {
    return NextResponse.json({ success: true, count: 0, message: 'No students enrolled' })
  }

  const course = (batch as any).courses
  const date = formatDate(batch.start_date)
  const time = batch.schedule || 'See schedule'
  const venue = batch.class_type === 'online' ? 'Online' : (batch.venue || 'TBD')
  const zoom = batch.zoom_link || undefined

  const daysMap = { week: 7, '2days': 2, day: 0 }
  const daysUntil = daysMap[type as keyof typeof daysMap] || 0

  let count = 0
  for (const enrollment of enrollments) {
    // The row IS the student now, rather than an embed beside them.
    const e = enrollment as { lead_id?: string; full_name?: string; phone?: string; email?: string }
    const student = { id: e.lead_id, full_name: e.full_name, phone: e.phone, email: e.email }
    if (!student.phone && !student.email) continue
    try {
      await onClassReminder(student, course?.name || batch.name, date, time, venue, daysUntil, zoom)
      count++
    } catch (e) {
      console.error('[Reminders] Error for student', student.id, e)
    }
  }

  // Log the reminder batch
  await sb.from('sms_logs').insert({
    recipient: `batch:${batchId}`,
    message: `Reminder type "${type}" sent to ${count} students for batch: ${batch.name}`,
    status: 'sent',
    provider: 'system',
  })

  return NextResponse.json({ success: true, count })
}

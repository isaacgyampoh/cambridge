import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { onClassReminder } from '@/lib/notifications'
import { formatDate } from '@/lib/utils'
import { verifySession } from '@/lib/auth/pin'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !['super_admin', 'project_manager', 'trainer', 'receptionist'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const { batchId, type } = await req.json()
  if (!batchId || !type) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  const sb = createServiceClient()

  const { data: batch } = await sb.from('batches')
    .select('*, courses(*)')
    .eq('id', batchId).single()

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  // Get all enrolled students
  const { data: enrollments } = await sb.from('batch_students')
    .select('*, student:student_id(*)')
    .eq('batch_id', batchId)

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
    const student = (enrollment as any).student
    if (!student) continue
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

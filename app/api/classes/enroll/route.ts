import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

/**
 * Enroll a registered student (by application) into a class batch.
 * If the class is online and has a Zoom link, the link is sent to the
 * new student automatically. Body: { batchId, applicationId }
 * Also supports removing: { batchId, applicationId, remove: true }
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid || !['super_admin', 'project_manager', 'admissions_officer', 'trainer'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const { batchId, applicationId, remove } = await req.json()
  if (!batchId || !applicationId) return NextResponse.json({ error: 'Missing batchId or applicationId' }, { status: 400 })

  const sb = createServiceClient()

  if (remove) {
    await sb.from('class_enrollments').delete().eq('batch_id', batchId).eq('application_id', applicationId)
    return NextResponse.json({ success: true, removed: true })
  }

  // Pull the applicant + batch
  const { data: app } = await sb.from('applications')
    .select('id, lead_id, full_name, email, phone').eq('id', applicationId).maybeSingle()
  if (!app) return NextResponse.json({ error: 'Application not found' }, { status: 404 })

  const { data: batch } = await sb.from('batches')
    .select('id, name, class_type, zoom_link, schedule, course:course_id(name)')
    .eq('id', batchId).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Class not found' }, { status: 404 })

  // Enroll (idempotent)
  const { error } = await sb.from('class_enrollments').upsert({
    batch_id: batchId, application_id: applicationId, lead_id: app.lead_id,
    full_name: app.full_name, email: app.email, phone: app.phone, status: 'active',
  }, { onConflict: 'batch_id,application_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-send the Zoom link to this new student if online + link present
  let zoomSent = false
  const b = batch as any
  if (b.class_type === 'online' && b.zoom_link && app.phone) {
    const first = (app.full_name || '').split(' ')[0] || 'there'
    const courseName = b.course?.name || 'your class'
    const msg = `Hello ${first}, welcome to your ${courseName} class${b.schedule ? ` (${b.schedule})` : ''}. Here is your Zoom link: ${b.zoom_link}`
    try { await sendWhatsAppText(app.phone, msg); zoomSent = true }
    catch { try { await sendSMS(app.phone, msg); zoomSent = true } catch {} }
  }

  return NextResponse.json({ success: true, zoomSent })
}

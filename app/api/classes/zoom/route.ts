import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { sendEmailGeneric } from '@/lib/integrations/email'

export const runtime = 'nodejs'

/**
 * Save a class (batch) Zoom link and optionally send it to all enrolled
 * students automatically. For online classes the link is sent to every
 * student in the batch by WhatsApp (SMS fallback) + email.
 *
 * Body: { batchId, zoomLink, send }  // send=true to blast now
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid || !['super_admin', 'project_manager', 'trainer'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const { batchId, zoomLink, send } = await req.json()
  if (!batchId) return NextResponse.json({ error: 'Missing batchId' }, { status: 400 })

  const sb = createServiceClient()

  // Save the link on the batch
  await sb.from('batches').update({ zoom_link: zoomLink || null }).eq('id', batchId)

  if (!send) return NextResponse.json({ success: true, saved: true })

  if (!zoomLink) return NextResponse.json({ error: 'No link to send' }, { status: 400 })

  // Get the batch + enrolled students
  const { data: batch } = await sb.from('batches')
    .select('id, name, schedule, course:course_id(name)')
    .eq('id', batchId).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Class not found' }, { status: 404 })

  const { data: enrolled } = await sb.from('class_enrollments')
    .select('full_name, phone, email')
    .eq('batch_id', batchId).eq('status', 'active')

  const students = (enrolled || []).filter((s: any) => s.phone || s.email)
  const courseName = (batch as any).course?.name || 'your class'

  let sent = 0
  for (const s of students) {
    const first = (s.full_name || '').split(' ')[0] || 'there'
    const msg = `Hello ${first}, here is the Zoom link for your ${courseName} class${batch.schedule ? ` (${batch.schedule})` : ''}: ${zoomLink}`
    let ok = false
    if (s.phone) {
      try { await sendWhatsAppText(s.phone, msg); ok = true } catch {}
      if (!ok) { try { await sendSMS(s.phone, msg); ok = true } catch {} }
    }
    if (s.email) {
      try {
        await sendEmailGeneric(s.email, `Zoom link — ${courseName}`,
          `<p>Hello ${first},</p><p>Here is the Zoom link for your <strong>${courseName}</strong> class${batch.schedule ? ` (${batch.schedule})` : ''}:</p><p><a href="${zoomLink}">${zoomLink}</a></p><p>See you in class,<br>Cambridge Center of Excellence</p>`)
        ok = true
      } catch {}
    }
    if (ok) sent++
  }

  return NextResponse.json({ success: true, sent, total: students.length })
}

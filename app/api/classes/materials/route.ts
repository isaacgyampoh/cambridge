import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { sendEmailGeneric } from '@/lib/integrations/email'

export const runtime = 'nodejs'

/**
 * Send course materials to all students enrolled in a class (batch).
 * Typically used after a session. Body: { batchId, title, link, note }
 * Sends by WhatsApp (SMS fallback) + email, and logs the send.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid || !['super_admin', 'project_manager', 'trainer'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const { batchId, title, link, note } = await req.json()
  if (!batchId || (!link && !note)) return NextResponse.json({ error: 'Provide a link or a note' }, { status: 400 })

  const sb = createServiceClient()
  const { data: batch } = await sb.from('batches').select('id, name, course:course_id(name)').eq('id', batchId).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Class not found' }, { status: 404 })

  const { data: enrolled } = await sb.from('class_enrollments')
    .select('full_name, phone, email').eq('batch_id', batchId).eq('status', 'active')
  const students = (enrolled || []).filter((s: any) => s.phone || s.email)
  const courseName = (batch as any).course?.name || 'your class'
  const heading = title || 'Course materials'

  // Record the material
  await sb.from('class_materials').insert({
    batch_id: batchId, title: heading, link: link || null, note: note || null,
    sent_by: session.userId, sent_to_count: students.length,
  }).then(() => {}, () => {})

  let sent = 0
  for (const s of students) {
    const first = (s.full_name || '').split(' ')[0] || 'there'
    const body = `Hello ${first}, ${heading} for your ${courseName} class:` +
      (note ? `\n\n${note}` : '') + (link ? `\n\n${link}` : '')
    let ok = false
    if (s.phone) {
      try { await sendWhatsAppText(s.phone, body); ok = true } catch {}
      if (!ok) { try { await sendSMS(s.phone, body); ok = true } catch {} }
    }
    if (s.email) {
      try {
        await sendEmailGeneric(s.email, `${heading} — ${courseName}`,
          `<p>Hello ${first},</p><p>${heading} for your <strong>${courseName}</strong> class:</p>${note ? `<p>${note}</p>` : ''}${link ? `<p><a href="${link}">${link}</a></p>` : ''}<p>Cambridge Centre of Excellence</p>`)
        ok = true
      } catch {}
    }
    if (ok) sent++
  }

  return NextResponse.json({ success: true, sent, total: students.length })
}

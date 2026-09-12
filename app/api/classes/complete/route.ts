import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { sendEmailGeneric } from '@/lib/integrations/email'
import { CONFIG } from '@/lib/config'
import { lookup } from '@/lib/db/lookup'

export const runtime = 'nodejs'

function token(n = 16) {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: n }, () => ch[Math.floor(Math.random() * ch.length)]).join('')
}

/**
 * Mark a class enrollment completed. If the student has paid FULL school
 * fees, automatically issue + send their certificate (email + WhatsApp).
 * Body: { enrollmentId, completed: true|false }
 */
export async function POST(req: NextRequest) {
  const tk = req.cookies.get('cce_session')?.value
  const session = tk ? await verifySession(tk) : { valid: false, role: '', userId: '' }
  if (!session.valid || !['super_admin', 'project_manager', 'trainer'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const { enrollmentId, completed } = await req.json()
  if (!enrollmentId) return NextResponse.json({ error: 'Missing enrollmentId' }, { status: 400 })

  const sb = createServiceClient()

  // Reopen case
  if (completed === false) {
    await sb.from('class_enrollments').update({ status: 'active', completed_at: null }).eq('id', enrollmentId)
    return NextResponse.json({ success: true, reopened: true })
  }

  // Mark completed
  await sb.from('class_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollmentId)

  const { data: enr } = await sb.from('class_enrollments')
    .select('*, batch:batch_id(name, course:course_id(name))').eq('id', enrollmentId).maybeSingle()
  if (!enr) return NextResponse.json({ success: true, certIssued: false })

  // GATE: only auto-issue the certificate if full school fees are paid
  if (!enr.fees_paid) {
    return NextResponse.json({ success: true, certIssued: false, reason: 'fees_not_paid' })
  }

  const courseName = (enr as any).batch?.course?.name || 'the programme'
  const month = new Date().toLocaleDateString('en-GH', { month: 'long', year: 'numeric' })

  /*
   * Avoid a duplicate certificate.
   *
   * This is the only thing standing between a student and a SECOND
   * certificate — a second certificate number minted from the random range,
   * a second download token, and two documents in circulation for one
   * completion, each of which verifies. Read as "no certificate yet", a
   * failed read produces exactly that.
   *
   * So a failure stops here. The class is already marked completed above, and
   * completing again is harmless, so the honest answer is to say the
   * certificate was not issued and let it be retried.
   */
  const { row: existing, failed: certFailed } = await lookup(
    sb.from('certificates').select('id, download_token').eq('enrollment_id', enrollmentId).maybeSingle(),
  )
  if (certFailed) {
    console.error('[classes/complete] certificate check failed:', certFailed)
    return NextResponse.json({
      success: true, certIssued: false,
      note: 'Marked complete. The certificate could not be checked just now — try issuing it again in a moment.',
    })
  }
  const dl = existing?.download_token || token()
  if (!existing) {
    const certNo = `CCE/CERT/${new Date().getFullYear()}/${String(Math.floor(1000 + Math.random() * 9000))}`
    await sb.from('certificates').insert({
      enrollment_id: enrollmentId, batch_id: enr.batch_id,
      student_name: enr.full_name, course_name: courseName,
      month_completed: month, certificate_no: certNo,
      email: enr.email, phone: enr.phone, download_token: dl,
      issued: true, issued_at: new Date().toISOString(),
    })
  } else {
    await sb.from('certificates').update({ issued: true, issued_at: new Date().toISOString() }).eq('id', existing.id)
  }

  // Send the download link + invite them to leave a testimonial
  const link = `${CONFIG.appUrl}/certificate/${dl}`
  const testimonialLink = `${CONFIG.appUrl}/testimonial/submit`
  const first = (enr.full_name || '').split(' ')[0] || 'there'
  const msg = `Congratulations ${first}! You've completed ${courseName} at Cambridge Center of Excellence and your certificate is ready. Download it here: ${link}\n\nWe'd love to hear about your experience — share a short testimonial here: ${testimonialLink}`
  let sent = false
  if (enr.phone) { try { await sendWhatsAppText(enr.phone, msg); sent = true } catch { try { await sendSMS(enr.phone, msg); sent = true } catch {} } }
  if (enr.email) { try { await sendEmailGeneric(enr.email, `Your certificate — ${courseName}`, `<p>Congratulations ${first},</p><p>You've completed <strong>${courseName}</strong>. Your certificate is ready.</p><p><a href="${link}">Download your certificate</a></p><p>Cambridge Center of Excellence</p>`); sent = true } catch {} }

  return NextResponse.json({ success: true, certIssued: true, sent })
}

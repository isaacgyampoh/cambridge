import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { CONFIG } from '@/lib/config'

/**
 * On-duty staff clicks one button -> the class sign-in link fans out to
 * every active student in the batch via WhatsApp. Each student receives it
 * through THEIR marketer's line (the marketer who registered them), so the
 * super admin / on-duty person doesn't need their own WhatsApp.
 * Body: { batchId }
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  // Anyone "on duty" — finance, reception, PM, admin, trainer — can trigger it
  if (!session.valid || !['super_admin', 'project_manager', 'accountant', 'receptionist', 'trainer', 'admissions_officer'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const { batchId } = await req.json()
  if (!batchId) return NextResponse.json({ error: 'Missing batchId' }, { status: 400 })

  const sb = createServiceClient()
  const { data: batch } = await sb.from('batches').select('id, name').eq('id', batchId).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Class not found' }, { status: 404 })

  // Active students of this class, with their registering marketer's line
  const { data: enrolled } = await sb.from('class_enrollments')
    .select('id, full_name, phone, application:application_id(marketer_id)')
    .eq('batch_id', batchId).eq('status', 'active')

  const link = `${CONFIG.appUrl}/signin/${batchId}`
  let sent = 0
  for (const e of enrolled || []) {
    if (!e.phone) continue
    const first = (e.full_name || '').split(' ')[0] || 'there'
    const marketerId = (e as any).application?.marketer_id || undefined
    const msg = `Hello ${first}, please sign in for today's ${batch.name} class here: ${link}\n\nYou can also check and pay any outstanding fees right from the link.`
    try { await sendWhatsAppText(e.phone, msg, marketerId); sent++ }
    catch { try { await sendSMS(e.phone, msg); sent++ } catch {} }
  }

  return NextResponse.json({ success: true, sent, total: (enrolled || []).length })
}

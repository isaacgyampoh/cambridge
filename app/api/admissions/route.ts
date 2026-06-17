import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS, SMS } from '@/lib/integrations/sms'
import { sendWhatsAppText, WA } from '@/lib/integrations/whatsapp'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !['super_admin', 'project_manager', 'admissions_officer'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const { leadId } = await req.json()
  if (!leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 })

  const sb = createServiceClient()

  const { data: lead } = await sb.from('leads').select('*, course:course_interest').eq('id', leadId).single()
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // Create admission record
  const { data: admission, error } = await sb.from('admissions').insert({
    lead_id: leadId,
    status: 'pending',
    notes: `Lead "${lead.full_name}" marked as ready to join.`,
  }).select().single()

  if (error) {
    console.error('[Admissions] Insert error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get all admissions officers and accountants
  const { data: officers } = await sb.from('profiles')
    .select('*')
    .in('role', ['admissions_officer', 'accountant'])
    .eq('is_active', true)

  const notifications = []
  const smsTasks = []

  for (const officer of officers || []) {
    // In-app notification
    notifications.push({
      user_id: officer.id,
      type: 'admission',
      title: officer.role === 'accountant' ? 'New student awaiting payment' : 'New admission case',
      body: `${lead.full_name} is ready to join${lead.course_interest ? ` (${lead.course_interest})` : ''}. Please process their admission.`,
      data: { lead_id: leadId, admission_id: admission.id },
    })

    // SMS
    if (officer.phone) {
      if (officer.role === 'admissions_officer') {
        smsTasks.push(sendSMS(officer.phone, SMS.readyToJoinToOfficer(officer.full_name, lead.full_name)))
      } else {
        smsTasks.push(sendSMS(officer.phone, SMS.readyToJoinToAccountant(lead.full_name)))
      }
    }
  }

  await Promise.all([
    sb.from('notifications').insert(notifications),
    ...smsTasks,
  ])

  // WhatsApp to lead
  if (lead.phone) {
    await sendWhatsAppText(lead.phone, WA.applicationConfirmed(
      lead.full_name,
      lead.course_interest || 'your chosen program'
    ))
  }

  // Schedule auto-send if officer doesn't act in 20 mins
  // (Handled by a cron job checking admissions where offer_letter_sent_at IS NULL and created_at < NOW() - INTERVAL '20 minutes')

  return NextResponse.json({ success: true, admission })
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS, SMS } from '@/lib/integrations/sms'
import { sendWhatsAppText, WA } from '@/lib/integrations/whatsapp'

export async function POST(req: NextRequest) {
  const { leadId, marketerId } = await req.json()
  if (!leadId || !marketerId) {
    return NextResponse.json({ error: 'Missing leadId or marketerId' }, { status: 400 })
  }

  const sb = createServiceClient()

  const [{ data: lead }, { data: marketer }] = await Promise.all([
    sb.from('leads').select('*').eq('id', leadId).single(),
    sb.from('profiles').select('*').eq('id', marketerId).single(),
  ])

  if (!lead || !marketer) {
    return NextResponse.json({ error: 'Lead or marketer not found' }, { status: 404 })
  }

  const results: Record<string, boolean> = {}

  // 1. SMS to marketer
  if (marketer.phone) {
    results.sms_marketer = await sendSMS(
      marketer.phone,
      SMS.leadAssignedToMarketer(marketer.full_name, lead.full_name)
    )
  }

  // 2. WhatsApp to lead — warm, personal, sent FROM the marketer's own line
  if (lead.phone) {
    results.wa_lead = await sendWhatsAppText(
      lead.phone,
      WA.leadAssigned(lead.full_name, marketer.full_name, lead.course_interest, marketer.wa_intro),
      marketerId,  // route through this marketer's WhatsApp instance
    )
  }

  // 3. Log activity
  await sb.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'whatsapp',
    subject: 'Assignment notification sent',
    description: `Lead assigned to ${marketer.full_name}. WhatsApp message sent to lead.`,
    created_by: marketer.id,
  })

  // 4. In-app notification for the marketer
  try {
    await sb.from('notifications').insert({
      user_id: marketer.id,
      type: 'lead_assigned',
      title: 'New lead assigned to you',
      body: `${lead.full_name}${lead.course_interest ? ` — interested in ${lead.course_interest}` : ''}. Reach out soon.`,
      link: `/marketer/leads/${leadId}`,
    })
  } catch {}

  return NextResponse.json({ success: true, results })
}

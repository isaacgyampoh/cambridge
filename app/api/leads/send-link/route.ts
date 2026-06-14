import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { CONFIG } from '@/lib/config'

/**
 * Send the marketer's registration link to a lead via WhatsApp.
 * Body: { leadId }
 * Used when a lead is marked 'interested' (auto) or manually by the marketer.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId } = await req.json()
  if (!leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 })

  const sb = createServiceClient()
  const { data: lead } = await sb.from('leads')
    .select('id, full_name, phone, assigned_to').eq('id', leadId).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  if (!lead.phone) return NextResponse.json({ error: 'Lead has no phone number' }, { status: 400 })

  // The marketer (assignee, else current user) and their link
  const marketerId = lead.assigned_to || session.userId
  const { data: marketer } = await sb.from('profiles')
    .select('full_name, marketer_code').eq('id', marketerId!).maybeSingle()

  if (!marketer?.marketer_code) {
    return NextResponse.json({ error: 'No registration link set for this marketer' }, { status: 400 })
  }

  const link = `${CONFIG.appUrl}/apply/${marketer.marketer_code}`
  const first = (lead.full_name || '').split(' ')[0] || 'there'
  const mFirst = (marketer.full_name || '').split(' ')[0] || ''
  const msg = `Hello ${first}, wonderful to hear you're interested in joining us at Cambridge Centre of Excellence.\n\nHere is your registration link:\n\n${link}\n\nClick it to fill in your details and pay your registration fee. Once that's done, you're registered and I'll guide you through the next steps.\n\nLet me know if you have any questions.\n\n${mFirst}`

  const sent = await sendWhatsAppText(lead.phone, msg, marketerId!)

  // Log it
  await sb.from('lead_activities').insert({
    lead_id: leadId, activity_type: 'whatsapp',
    subject: 'Registration link sent',
    description: `Sent the registration link via WhatsApp.`,
    created_by: session.userId,
  })

  if (!sent) return NextResponse.json({ error: 'Could not send WhatsApp message', link }, { status: 502 })
  return NextResponse.json({ success: true, link })
}

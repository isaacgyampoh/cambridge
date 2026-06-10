import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS, SMS } from '@/lib/integrations/sms'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { full_name, email, phone, course_interest, utm_source, utm_medium, utm_campaign, referrer_code } = body

  if (!full_name) {
    return NextResponse.json({ error: 'full_name is required' }, { status: 400 })
  }

  const sb = createServiceClient()

  // Check for referrer marketer
  let referrerId = null
  if (referrer_code) {
    const { data: ref } = await sb.from('profiles').select('id').eq('marketer_code', referrer_code).single()
    referrerId = ref?.id || null
  }

  const { data: lead, error } = await sb.from('leads').insert({
    full_name,
    email: email || null,
    phone: phone || null,
    source: 'website',
    status: 'new',
    course_interest: course_interest || null,
    utm_source: utm_source || 'website',
    utm_medium: utm_medium || null,
    utm_campaign: utm_campaign || null,
    referrer_id: referrerId,
    raw_payload: body,
  }).select().single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Notify PMs
  const { data: pms } = await sb.from('profiles')
    .select('*').eq('role', 'project_manager').eq('is_active', true)

  const { count: unassigned } = await sb.from('leads')
    .select('id', { count: 'exact', head: true }).is('assigned_to', null)

  for (const pm of pms || []) {
    await Promise.all([
      sb.from('notifications').insert({
        user_id: pm.id,
        type: 'lead',
        title: 'New lead from website',
        body: `${lead.full_name} submitted a form on the website.`,
        data: { lead_id: lead.id, source: 'website' },
      }),
      pm.phone ? sendSMS(pm.phone, SMS.newLeadToPM(lead.full_name, 'Website', unassigned || 1)) : Promise.resolve(),
    ])
  }

  return NextResponse.json({ success: true, lead_id: lead.id })
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { onNewLead } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const sb = createServiceClient()

  // Google Lead Form sends: lead_id, user_column_data [{column_name, string_value}]
  const fields: Record<string, string> = {}
  for (const col of body.user_column_data || []) {
    fields[col.column_name.toLowerCase().replace(/\s+/g, '_')] = col.string_value
  }

  const { data: lead, error } = await sb.from('leads').insert({
    full_name: fields.full_name || fields.name || 'Google Lead',
    email: fields.email || fields.email_address || null,
    phone: fields.phone_number || fields.phone || null,
    source: 'google',
    status: 'new',
    course_interest: fields.course || fields.program_of_interest || null,
    utm_source: 'google',
    utm_campaign: body.campaign_name || null,
    raw_payload: body,
  }).select().single()

  if (error) {
    console.error('[Google Webhook]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await onNewLead(lead)
  return NextResponse.json({ success: true, lead_id: lead.id })
}

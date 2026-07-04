import { NextRequest, NextResponse } from 'next/server'
import { intakeLead } from '@/lib/leadIntake'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/**
 * GET — simple health check so you can confirm the endpoint is live
 * (open it in a browser; Google itself only ever POSTs here).
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'google-lead-webhook',
    ready: true,
    keyConfigured: !!CONFIG.googleLeadKey,
    note: 'Google Lead Form Extensions should POST here. Leads auto-assign to a marketer on arrival.',
  })
}

/**
 * Google Lead Form Extensions webhook.
 * Google sends: { lead_id, campaign_id, user_column_data: [{column_name, string_value}], google_key }
 * Set a shared secret in the form ("key") and check it here.
 */
export async function POST(req: NextRequest) {
  const body = await req.json()

  // Optional shared-secret check (Google lets you set a "key" on the form)
  if (CONFIG.googleLeadKey && body.google_key && body.google_key !== CONFIG.googleLeadKey) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 401 })
  }

  const fields: Record<string, string> = {}
  for (const col of body.user_column_data || []) {
    fields[(col.column_name || '').toLowerCase().replace(/\s+/g, '_')] = col.string_value || ''
  }

  const { leadId, duplicate } = await intakeLead({
    full_name: fields.full_name || fields.name || '',
    email: fields.email || fields.email_address || null,
    phone: fields.phone_number || fields.phone || null,
    source: 'google',
    course_interest: fields.course || fields.program_of_interest || fields.program || null,
    utm_source: 'google',
    utm_campaign: body.campaign_id ? String(body.campaign_id) : null,
    raw_payload: body,
  })

  return NextResponse.json({ success: true, lead_id: leadId, duplicate })
}

import { NextRequest, NextResponse } from 'next/server'
import { intakeLead } from '@/lib/leadIntake'
import { SECRETS } from '@/lib/config.server'
import { guardLeadWebhook } from '@/lib/webhooks/leadGuard'

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
    keyConfigured: !!SECRETS.googleLeadKey,
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

  /*
   * The shared secret, checked properly.
   *
   * This read `if (key && body.google_key && body.google_key !== key)`, which
   * rejects only a WRONG key: omitting `google_key` made the middle condition
   * false and skipped the test entirely. The way past the lock was to leave
   * it alone.
   */
  const guard = await guardLeadWebhook({ req, source: 'google', secret: SECRETS.googleLeadKey, bodyKey: body.google_key })
  if (!guard.ok) return guard.response

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

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { intakeLead } from '@/lib/leadIntake'
import { guardLeadWebhook } from '@/lib/webhooks/leadGuard'
import { SECRETS } from '@/lib/config.server'

export const runtime = 'nodejs'

/**
 * Generic website / landing-page lead capture. POST a JSON body with
 * full_name, email, phone, course_interest, and optional UTM + referrer_code.
 */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { full_name, email, phone, course_interest, utm_source, utm_medium, utm_campaign, utm_content, referrer_code } = body

  // Anyone could post here, and posting here sends WhatsApp to the number in
  // the body. See lib/webhooks/leadGuard.ts.
  const guard = await guardLeadWebhook({ req, source: 'website', secret: SECRETS.websiteLeadKey, bodyKey: body.key })
  if (!guard.ok) return guard.response

  if (!full_name && !phone && !email) {
    return NextResponse.json({ error: 'Provide at least a name, phone or email' }, { status: 400 })
  }

  // Optional: attribute to a specific marketer by their code
  const extra: Record<string, any> = {}
  if (referrer_code) {
    const sb = createServiceClient()
    const { data: ref } = await sb.from('profiles').select('id').eq('marketer_code', referrer_code).maybeSingle()
    if (ref?.id) extra.referrer_id = ref.id
  }

  const { leadId, duplicate } = await intakeLead({
    full_name, email, phone,
    source: 'website',
    course_interest,
    utm_source: utm_source || 'website',
    utm_medium, utm_campaign, utm_content,
    raw_payload: body,
    extra,
  })

  return NextResponse.json({ success: true, lead_id: leadId, duplicate })
}

import { CONFIG } from '@/lib/config'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { intakeLead } from '@/lib/leadIntake'
import crypto from 'crypto'

export const runtime = 'nodejs'

// Facebook webhook verification
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === CONFIG.facebookVerifyToken) {
    return new Response(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// Facebook sends lead data here
export async function POST(req: NextRequest) {
  const body = await req.text()
  const sb = createServiceClient()

  // TEMP debug: record that a webhook hit arrived, and why it may fail.
  // Remove once Facebook leads are confirmed flowing.
  const sig = req.headers.get('x-hub-signature-256') || ''
  const expected = 'sha256=' + crypto
    .createHmac('sha256', CONFIG.facebookAppSecret || '')
    .update(body)
    .digest('hex')
  const sigOk = sig === expected
  try {
    await sb.from('webhook_debug').insert({
      source: 'facebook',
      detail: JSON.stringify({
        received: true,
        signaturePresent: !!sig,
        signatureMatches: sigOk,
        appSecretSet: !!CONFIG.facebookAppSecret,
        pageTokenSet: !!CONFIG.facebookPageAccessToken,
        bodyPreview: body.slice(0, 500),
      }),
    })
  } catch {}

  if (!sigOk && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const payload = JSON.parse(body)

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue

      const { leadgen_id, page_id, form_id } = change.value

      // Fetch lead data from Facebook Graph API
      let leadData: any = {}
      try {
        const res = await fetch(
          `https://graph.facebook.com/v18.0/${leadgen_id}?access_token=${CONFIG.facebookPageAccessToken}`,
          { signal: AbortSignal.timeout(8000) }
        )
        leadData = await res.json()
      } catch (e) {
        console.error('[FB Webhook] Failed to fetch lead:', e)
      }

      // Parse field data
      const fields: Record<string, string> = {}
      for (const f of leadData.field_data || []) {
        fields[f.name] = f.values?.[0] || ''
      }

      const phone = fields.phone_number || fields.phone || ''
      const email = fields.email || ''
      const name = fields.full_name || `${fields.first_name || ''} ${fields.last_name || ''}`.trim()
      // Facebook form fields for this account: full name, email, phone, city,
      // educational level. Field keys can vary slightly, so check the common ones.
      const city = fields.city || fields.town || null
      const education = fields.education_level || fields.educational_level || fields.education || fields.level_of_education || null

      // Unified intake: de-dupe, create, auto-assign (+ AI opening), notify PMs
      await intakeLead({
        full_name: name,
        email: email || null,
        phone: phone || null,
        source: 'facebook',
        course_interest: fields.course || fields.program || null,
        city, education_level: education,
        utm_source: 'facebook',
        utm_campaign: fields.campaign_name || null,
        raw_payload: leadData,
        extra: { fb_lead_id: leadgen_id },
      })
    }
  }

  return NextResponse.json({ received: true })
}

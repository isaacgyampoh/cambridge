import { CONFIG } from '@/lib/config'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { autoAssignLead } from '@/lib/autoAssign'
import { sendSMS, SMS } from '@/lib/integrations/sms'
import crypto from 'crypto'

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

  // Verify signature
  const sig = req.headers.get('x-hub-signature-256') || ''
  const expected = 'sha256=' + crypto
    .createHmac('sha256', CONFIG.facebookAppSecret || '')
    .update(body)
    .digest('hex')

  if (sig !== expected && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const payload = JSON.parse(body)
  const sb = createServiceClient()

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

      // Insert lead
      const { data: lead, error } = await sb.from('leads').insert({
        full_name: name || 'Facebook Lead',
        email: email || null,
        phone: phone || null,
        source: 'facebook',
        status: 'new',
        course_interest: fields.course || fields.program || null,
        fb_lead_id: leadgen_id,
        utm_source: 'facebook',
        raw_payload: leadData,
      }).select().single()

      if (error) {
        console.error('[FB Webhook] Insert error:', error)
        continue
      }

      // Auto-assign to a marketer (round-robin by lightest load)
      try {
        const assignedTo = await autoAssignLead(lead.id)
        if (assignedTo) lead.assigned_to = assignedTo
      } catch (e) { console.error('[FB Webhook] auto-assign failed', e) }

      // Notify all project managers
      await notifyPMs(sb, lead)
    }
  }

  return NextResponse.json({ received: true })
}

async function notifyPMs(sb: any, lead: any) {
  const { data: pms } = await sb.from('profiles')
    .select('*').eq('role', 'project_manager').eq('is_active', true)

  const { count: unassigned } = await sb.from('leads')
    .select('id', { count: 'exact', head: true })
    .is('assigned_to', null)

  for (const pm of pms || []) {
    // In-app
    await sb.from('notifications').insert({
      user_id: pm.id,
      type: 'lead',
      title: 'New lead from Facebook',
      body: `${lead.full_name} submitted a lead from Facebook.`,
      data: { lead_id: lead.id, source: 'facebook' },
    })
    // SMS
    if (pm.phone) {
      await sendSMS(pm.phone, SMS.newLeadToPM(lead.full_name, 'Facebook Ads', unassigned || 1))
    }
  }
}

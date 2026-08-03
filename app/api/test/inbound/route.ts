import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager']

/**
 * Simulate a lead's WhatsApp message arriving, running the REAL webhook.
 * This separates "WaSender is not delivering to us" from "our logic is
 * refusing to answer", without needing anyone to send a real message.
 *
 * Body: { phone, message }
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { phone, message } = await req.json().catch(() => ({}))
  if (!phone) return NextResponse.json({ error: 'Enter the lead phone number to test with.' }, { status: 400 })

  const sb = createServiceClient()
  const digits = String(phone).replace(/[^0-9]/g, '')
  const variants = [digits, digits.replace(/^0/, '233'), digits.replace(/^233/, '0'), '+' + digits.replace(/^0/, '233')]

  // Step 1 — is this number a lead at all?
  const { data: lead } = await sb.from('leads')
    .select('id, full_name, phone, status, assigned_to, ai_paused, needs_human')
    .in('phone', variants).order('created_at', { ascending: false }).limit(1).maybeSingle()

  const steps: any[] = [{
    step: 'Find the lead',
    ok: !!lead,
    detail: lead
      ? `Matched ${lead.full_name} (stored as ${lead.phone})`
      : `No lead has any of these numbers: ${variants.join(', ')}`,
  }]

  if (!lead) {
    return NextResponse.json({ ok: false, steps, verdict: 'This number is not a lead, so the assistant will never reply to it. Add them as a lead first.' })
  }

  steps.push({
    step: 'Assistant active?',
    ok: !lead.ai_paused,
    detail: lead.ai_paused ? 'Paused on this lead — use Resume assistant' : 'Active',
  })
  steps.push({
    step: 'Lead status',
    ok: !['registered', 'not_interested', 'lost'].includes(String(lead.status || '')),
    detail: `Status is "${lead.status}"${['registered', 'not_interested', 'lost'].includes(String(lead.status || '')) ? ' — the assistant does not sell to these' : ''}`,
  })

  // Step 2 — call the real webhook exactly as WaSender would
  const origin = new URL(req.url).origin
  const payload = {
    data: { messages: {
      key: { remoteJid: `${digits.replace(/^0/, '233')}@s.whatsapp.net`, fromMe: false, id: `test-${Date.now()}` },
      message: { conversation: message || 'Hello, I want to know more about the course' },
    } },
  }

  let webhookStatus = 0
  let webhookBody = ''
  try {
    const r = await fetch(`${origin}/api/webhooks/whatsapp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(45000),
    })
    webhookStatus = r.status
    webhookBody = (await r.text()).slice(0, 400)
  } catch (e: any) {
    webhookBody = e?.message || 'could not reach the webhook'
  }

  steps.push({
    step: 'Webhook processed it',
    ok: webhookStatus === 200,
    detail: `HTTP ${webhookStatus} — ${webhookBody}`,
  })

  // Step 3 — did a reply actually get sent out?
  const { data: convo } = await sb.from('ai_conversations')
    .select('reply_text, answered_by, created_at').in('phone', variants)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  const fresh = convo?.created_at && (Date.now() - new Date(convo.created_at).getTime()) < 90000

  steps.push({
    step: 'Reply generated',
    ok: !!(fresh && convo?.reply_text),
    detail: fresh && convo?.reply_text ? `"${String(convo.reply_text).slice(0, 160)}"` : 'No reply was produced for this message',
  })

  const { data: sent } = await sb.from('whatsapp_logs')
    .select('status, provider_response, created_at').in('recipient', variants.map(v => '+' + v.replace(/^\+/, '').replace(/^0/, '233')))
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  const sentFresh = sent?.created_at && (Date.now() - new Date(sent.created_at).getTime()) < 90000

  steps.push({
    step: 'Sent to WhatsApp',
    ok: !!(sentFresh && sent?.status === 'sent'),
    detail: sentFresh
      ? `${sent.status} — ${JSON.stringify(sent.provider_response).slice(0, 200)}`
      : 'Nothing was sent out for this message',
  })

  const failed = steps.find(s => !s.ok)
  return NextResponse.json({
    ok: !failed,
    steps,
    verdict: failed
      ? `Stops at: ${failed.step}. ${failed.detail}`
      : 'Working end to end. If real leads still get nothing, WaSender is not delivering their messages — check the webhook URL in WaSender.',
    apiKeySet: !!CONFIG.wasenderApiKey,
  })
}

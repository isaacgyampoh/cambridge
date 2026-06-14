import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateAssistantReply } from '@/lib/integrations/ai-assistant'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { CONFIG } from '@/lib/config'

/**
 * Incoming WhatsApp webhook (called by WAWP when a lead replies).
 * Flow:
 *   1. Parse sender phone + message text (WAWP payloads vary, so we're flexible)
 *   2. Match the phone to a lead, and find the assigned marketer
 *   3. Ask the AI to answer using the FAQ knowledge base, in the marketer's voice
 *   4. Send the reply back through the marketer's own WhatsApp line
 *   5. Log the exchange for oversight
 */
export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {
    // some providers send form-encoded
    try { const t = await req.text(); body = Object.fromEntries(new URLSearchParams(t)) } catch {}
  }

  // Flexible extraction across WAWP payload shapes
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = k.split('.').reduce((o: any, p) => (o ? o[p] : undefined), body)
      if (v) return String(v)
    }
    return ''
  }

  const fromRaw = pick('from', 'sender', 'phone', 'number', 'data.from', 'data.sender', 'contact.wa_id', 'wa_id')
  const text = pick('message', 'text', 'body', 'data.message', 'data.body', 'message.text', 'text.body')
  const fromMe = pick('fromMe', 'from_me', 'data.fromMe') === 'true'

  // Ignore our own outbound messages and empty payloads
  if (!fromRaw || !text || fromMe) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const phone = fromRaw.replace(/[^0-9]/g, '').replace(/@.*/, '')
  const variants = [phone, phone.replace(/^0/, '233'), phone.replace(/^233/, '0'), phone.replace(/^233/, ''), '0' + phone.replace(/^233/, '')]

  const sb = createServiceClient()

  // Find the lead by phone
  const { data: leads } = await sb.from('leads')
    .select('id, full_name, phone, course_interest, assigned_to')
    .limit(3000)
  const lead = (leads || []).find((l: any) => l.phone && variants.includes(l.phone.replace(/[^0-9]/g, '')))

  // Find the assigned marketer (for voice + sending line + their link)
  let marketer: any = null
  if (lead?.assigned_to) {
    const { data: m } = await sb.from('profiles')
      .select('id, full_name, wa_intro, marketer_code').eq('id', lead.assigned_to).maybeSingle()
    marketer = m
  }

  // ── Registration intent: send the link automatically ──
  // If the lead signals they want to register, send their marketer's
  // registration link straight away instead of a generic reply.
  const lower = text.toLowerCase()
  const wantsToRegister = /\b(register|sign ?up|enroll|enrol|join|pay|send.*(link|form)|i'?m ready|am ready|ready to)\b/.test(lower)
    && /\b(register|sign ?up|enroll|enrol|join|link|form|pay|ready)\b/.test(lower)

  if (wantsToRegister && marketer?.marketer_code) {
    const link = `${CONFIG.appUrl}/apply/${marketer.marketer_code}`
    const first = (lead?.full_name || '').split(' ')[0] || 'there'
    const mFirst = (marketer.full_name || '').split(' ')[0] || ''
    const linkMsg = `Wonderful, ${first}. Here is your registration link:\n\n${link}\n\nClick it to fill in your details and pay your registration fee. Once that's done you're all set, and I'll take it from there. Let me know if you need any help.\n\n${mFirst}`

    const sent = await sendWhatsAppText(phone, linkMsg, marketer.id)
    await sb.from('ai_conversations').insert({
      phone, lead_id: lead?.id || null, marketer_id: marketer?.id || null,
      incoming_text: text, reply_text: linkMsg, answered_by: sent ? 'ai_link' : 'fallback',
    })
    // Notify the marketer their lead asked to register
    if (marketer.id) {
      await sb.from('notifications').insert({
        user_id: marketer.id, type: 'register_intent',
        title: 'A lead wants to register',
        body: `${lead?.full_name || phone} asked to register. The registration link was sent automatically.`,
        link: lead?.id ? `/marketer/leads/${lead.id}` : '/marketer',
      })
    }
    return NextResponse.json({ ok: true, sentLink: true })
  }

  // Pull short recent history with this phone for continuity
  const { data: prior } = await sb.from('ai_conversations')
    .select('incoming_text, reply_text')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(3)
  const history: { role: 'user' | 'assistant'; content: string }[] = []
  ;(prior || []).reverse().forEach((p: any) => {
    if (p.incoming_text) history.push({ role: 'user', content: p.incoming_text })
    if (p.reply_text) history.push({ role: 'assistant', content: p.reply_text })
  })

  // Generate the AI reply
  const reply = await generateAssistantReply(text, {
    leadName: lead?.full_name,
    marketerName: marketer?.full_name,
    marketerIntro: marketer?.wa_intro,
    courseInterest: lead?.course_interest,
    registrationLink: marketer?.marketer_code ? `${CONFIG.appUrl}/apply/${marketer.marketer_code}` : null,
  }, history)

  let answeredBy = 'skipped'
  if (reply) {
    // Send back via the marketer's own line (falls back to central inside sender)
    const ok = await sendWhatsAppText(phone, reply, marketer?.id || null)
    answeredBy = ok ? 'ai' : 'fallback'
  }

  // Log
  await sb.from('ai_conversations').insert({
    phone,
    lead_id: lead?.id || null,
    marketer_id: marketer?.id || null,
    incoming_text: text,
    reply_text: reply || null,
    answered_by: answeredBy,
  })

  return NextResponse.json({ ok: true, answered: !!reply })
}

export async function GET() {
  return NextResponse.json({ ok: true, message: 'WhatsApp webhook is live.' })
}

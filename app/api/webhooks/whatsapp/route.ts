import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateAssistantReply } from '@/lib/integrations/ai-assistant'
import { sendWhatsAppText, sendWhatsAppMedia } from '@/lib/integrations/whatsapp'
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
  // Media type (voice note, image, document) — the AI can't process these,
  // so they trigger a human handoff.
  const mediaType = pick('type', 'data.type', 'message.type', 'messageType', 'media_type')
  const isMedia = /audio|voice|ptt|image|video|document|sticker/i.test(mediaType)

  // Ignore our own outbound messages and empty payloads (unless it's media)
  if (!fromRaw || fromMe || (!text && !isMedia)) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const phone = fromRaw.replace(/[^0-9]/g, '').replace(/@.*/, '')
  const variants = [phone, phone.replace(/^0/, '233'), phone.replace(/^233/, '0'), phone.replace(/^233/, ''), '0' + phone.replace(/^233/, '')]

  const sb = createServiceClient()

  // ── Idempotency guard ──
  // WhatsApp providers (WAWP) frequently deliver the same message webhook more
  // than once. Without this, the lead gets the same reply twice. If we've
  // already handled this exact message (same phone + same text) in the last
  // 60 seconds, skip it silently.
  const msgId = pick('id', 'message_id', 'data.id', 'messageId', 'key.id')
  try {
    const since = new Date(Date.now() - 60000).toISOString()
    const { data: recent } = await sb.from('ai_conversations')
      .select('id, incoming_text')
      .eq('phone', phone)
      .gte('created_at', since)
      .limit(5)
    const seen = (recent || []).some((r: any) => text && (r.incoming_text || '').trim() === text.trim())
    if (seen) return NextResponse.json({ ok: true, duplicate: true })
  } catch { /* if the check fails, continue — better to risk a dup than drop a real message */ }

  // Find the lead by phone
  const { data: leads } = await sb.from('leads')
    .select('id, full_name, phone, course_interest, assigned_to, ai_paused')
    .limit(3000)
  const lead = (leads || []).find((l: any) => l.phone && variants.includes(l.phone.replace(/[^0-9]/g, '')))

  // Find the assigned marketer (for voice + sending line + their link)
  let marketer: any = null
  if (lead?.assigned_to) {
    const { data: m } = await sb.from('profiles')
      .select('id, full_name, wa_intro, marketer_code').eq('id', lead.assigned_to).maybeSingle()
    marketer = m
  }

  // ── Human-in-the-loop handoff ──
  const lower0 = (text || '').toLowerCase()
  const asksForHuman = /\b(speak|talk|call me|call back|human|agent|real person|someone|representative|customer service|manager)\b/.test(lower0)
  const frustrated = /\b(useless|stop|not helpful|nonsense|annoying|frustrat|complain|refund|angry|disappointed)\b/.test(lower0)

  async function handOff(reason: string) {
    if (lead?.id) {
      await sb.from('leads').update({ ai_paused: true, needs_human: true, needs_human_at: new Date().toISOString() }).eq('id', lead.id).then(() => {}, () => {})
    }
    const note = {
      type: 'handoff', title: 'A chat needs you',
      body: `${lead?.full_name || phone} ${reason}. Jump into WhatsApp to continue.`,
      link: lead?.id ? `/marketer/leads/${lead.id}` : '/marketer/leads',
    }
    if (marketer?.id) {
      await sb.from('notifications').insert({ user_id: marketer.id, ...note }).then(() => {}, () => {})
      try {
        const { data: mp } = await sb.from('profiles').select('phone, full_name').eq('id', marketer.id).maybeSingle()
        if (mp?.phone) {
          const { sendSMS } = await import('@/lib/integrations/sms')
          await sendSMS(mp.phone, `${(mp.full_name || '').split(' ')[0] || 'Hi'}, ${lead?.full_name || 'a lead'} needs a human reply on WhatsApp. Open your portal to continue.`)
        }
      } catch {}
    } else {
      const { data: mgrs } = await sb.from('profiles').select('id').in('role', ['super_admin', 'project_manager']).eq('is_active', true).limit(10)
      for (const mgr of mgrs || []) await sb.from('notifications').insert({ user_id: mgr.id, ...note }).then(() => {}, () => {})
    }
    await sb.from('ai_conversations').insert({
      phone, lead_id: lead?.id || null, marketer_id: marketer?.id || null,
      incoming_text: text || `[${mediaType || 'media'}]`, reply_text: null, answered_by: 'handoff',
    }).then(() => {}, () => {})
  }

  // 1) Voice note / image / document — AI can't process it.
  if (isMedia && !text) {
    await handOff('sent a voice note or file')
    await sendWhatsAppText(phone, `Thanks! I've passed this to ${(marketer?.full_name || 'our team').split(' ')[0]}, who'll get back to you shortly.`, marketer?.id || null).catch(() => {})
    return NextResponse.json({ ok: true, handoff: 'media' })
  }

  // 2) Lead already handled by a human — don't let the AI butt in.
  if (lead?.ai_paused) {
    if (marketer?.id) {
      await sb.from('notifications').insert({
        user_id: marketer.id, type: 'message',
        title: `New WhatsApp from ${lead?.full_name || phone}`,
        body: (text || 'New message').slice(0, 80),
        link: lead?.id ? `/marketer/leads/${lead.id}` : '/marketer/leads',
      }).then(() => {}, () => {})
    }
    await sb.from('ai_conversations').insert({
      phone, lead_id: lead?.id || null, marketer_id: marketer?.id || null,
      incoming_text: text, reply_text: null, answered_by: 'human_handling',
    }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, humanHandling: true })
  }

  // 3) Lead explicitly wants a person, or is frustrated → hand off.
  if (asksForHuman || frustrated) {
    await handOff(asksForHuman ? 'asked to speak with someone' : 'seems frustrated')
    await sendWhatsAppText(phone, `Of course — I'm connecting you with ${(marketer?.full_name || 'a colleague').split(' ')[0]}, who'll continue with you here shortly.`, marketer?.id || null).catch(() => {})
    return NextResponse.json({ ok: true, handoff: 'requested' })
  }

  // ── Registration intent: send the link automatically ──
  // If the lead signals they want to register, send their marketer's
  // registration link straight away instead of a generic reply.
  const lower = text.toLowerCase()

  // ── Brochure intent: send the course brochure PDF ──
  // If the lead asks about fees, price, details or a brochure, and their
  // course of interest has a brochure uploaded, send the PDF with the reply.
  const wantsBrochure = /\b(brochure|flyer|price|prices|pricing|fee|fees|cost|how much|details|more info|information|tell me more)\b/.test(lower)
  if (wantsBrochure && lead?.course_interest) {
    const { data: course } = await sb.from('courses')
      .select('name, brochure_url').or(`code.eq.${lead.course_interest},name.ilike.%${lead.course_interest}%`).maybeSingle()
    if (course?.brochure_url) {
      const first = (lead?.full_name || '').split(' ')[0] || 'there'
      const mFirst = (marketer?.full_name || '').split(' ')[0] || ''
      const caption = `Here you go, ${first} — full details of our ${course.name} programme are in this brochure. Let me know if you'd like to register or have any questions.${mFirst ? `\n\n${mFirst}` : ''}`
      const sent = await sendWhatsAppMedia(phone, caption, course.brochure_url, marketer?.id || null)
      await sb.from('ai_conversations').insert({
        phone, lead_id: lead?.id || null, marketer_id: marketer?.id || null,
        incoming_text: text, reply_text: '[brochure sent] ' + caption, answered_by: sent ? 'ai_brochure' : 'fallback',
      }).then(() => {}, () => {})
      if (sent) return NextResponse.json({ ok: true, brochure: true })
    }
  }

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
    .limit(8)
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

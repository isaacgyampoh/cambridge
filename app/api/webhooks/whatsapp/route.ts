import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { readConversation } from '@/lib/integrations/conversationState'
import { maybeResumeAI } from '@/lib/aiResume'
import { sendSMS } from '@/lib/integrations/sms'
import { generateAssistantReply } from '@/lib/integrations/ai-assistant'
import { sendWhatsAppText, sendWhatsAppMedia } from '@/lib/integrations/whatsapp'
import { CONFIG } from '@/lib/config'

/**
 * Incoming WhatsApp webhook (called by WaSender when a lead replies).
 * Flow:
 *   1. Parse sender phone + message text (provider payloads vary, so we're flexible)
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

  // Flexible extraction across provider payload shapes
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = k.split('.').reduce((o: any, p) => (o ? o[p] : undefined), body)
      if (v) return String(v)
    }
    return ''
  }

  // Field names vary by provider. WaSender delivers Baileys-style payloads:
  //   data.messages.key.remoteJid / .fromMe, data.messages.message.conversation
  const fromRaw = pick(
    'data.messages.key.remoteJid', 'data.key.remoteJid', 'key.remoteJid',
    'from', 'sender', 'phone', 'number', 'data.from', 'data.sender', 'contact.wa_id', 'wa_id',
  )
  const text = pick(
    'data.messages.message.conversation',
    'data.messages.message.extendedTextMessage.text',
    'data.message.conversation', 'message.conversation',
    'message', 'text', 'body', 'data.message', 'data.body', 'message.text', 'text.body',
  )
  const fromMe = ['true', '1'].includes(String(
    pick('data.messages.key.fromMe', 'data.key.fromMe', 'key.fromMe', 'fromMe', 'from_me', 'data.fromMe')
  ))
  // Media type (voice note, image, document) — the AI can't process these,
  // so they trigger a human handoff.
  const mediaType = pick(
    'type', 'data.type', 'message.type', 'messageType', 'media_type',
    'data.messages.message.audioMessage.mimetype',
    'data.messages.message.imageMessage.mimetype',
    'data.messages.message.documentMessage.mimetype',
    'data.messages.message.videoMessage.mimetype',
  ) || (
    // Baileys nests media under a *Message key — detect by presence
    ['audioMessage','imageMessage','videoMessage','documentMessage','stickerMessage']
      .find(k => (body?.data?.messages?.message || body?.data?.message || {})[k]) || ''
  )
  const isMedia = /audio|voice|ptt|image|video|document|sticker/i.test(String(mediaType))

  if (!fromRaw || (!text && !isMedia)) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const phone = fromRaw.replace(/[^0-9]/g, '').replace(/@.*/, '')
  const variants = [phone, phone.replace(/^0/, '233'), phone.replace(/^233/, '0'), phone.replace(/^233/, ''), '0' + phone.replace(/^233/, '')]

  const sb = createServiceClient()

  // ── MANUAL TAKEOVER DETECTION ──
  // A fromMe message means a HUMAN (the marketer) just replied from their own
  // WhatsApp. Pause the AI for that lead so the two never talk over each other,
  // and record what the marketer said so the AI keeps full context if it later
  // resumes.
  if (fromMe) {
    try {
      const { data: lead } = await sb.from('leads')
        .select('id, assigned_to, ai_paused').in('phone', variants).limit(1).maybeSingle()

      // The provider also echoes back messages WE sent. If this text matches
      // something the system just sent, it is not a human takeover — ignore it.
      // Without this, the AI's own greeting paused the AI and the lead's reply
      // never got answered.
      const norm = (v: string) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase()
      let isOurOwn = false
      if (text) {
        const { data: recentOut } = await sb.from('ai_conversations')
          .select('reply_text')
          .in('phone', variants)
          .gte('created_at', new Date(Date.now() - 10 * 60000).toISOString())
          .limit(10)
        isOurOwn = (recentOut || []).some((r: any) => r.reply_text && norm(r.reply_text) === norm(text))
      }
      if (isOurOwn) return NextResponse.json({ ok: true, echo: true })

      if (lead?.id) {
        await sb.from('leads').update({
          ai_paused: true, needs_human: false,
          ai_paused_at: lead.ai_paused ? undefined : new Date().toISOString(),
          ai_paused_by: 'human',
          last_human_at: new Date().toISOString(),
        }).eq('id', lead.id).then(() => {}, () => {})
        await sb.from('ai_conversations').insert({
          phone, lead_id: lead.id, marketer_id: lead.assigned_to || null,
          incoming_text: null, reply_text: text || `[${mediaType || 'media'}]`,
          answered_by: 'human',
        }).then(() => {}, () => {})
      }
    } catch {}
    return NextResponse.json({ ok: true, manual_takeover: true })
  }

  // ── Idempotency guard ──
  // WhatsApp providers frequently deliver the same message webhook more
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
  // Indexed lookup on the phone variants (previously pulled 3000 leads into
  // memory on every inbound message — slow and it silently missed lead 3001+).
  const { data: lead } = await sb.from('leads')
    .select('id, full_name, phone, course_interest, assigned_to, ai_paused, profession, status')
    .in('phone', variants).order('created_at', { ascending: false }).limit(1).maybeSingle()

  // ── HARD RULE: the assistant only ever speaks to people who are leads in
  // this system. A staff WhatsApp line also carries their family, friends and
  // existing customers — the assistant must never reply to those. If the
  // number is not a lead, we record nothing and stay silent.
  if (!lead?.id) {
    return NextResponse.json({ ok: true, ignored: 'not_a_lead' })
  }

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

  // 1) Voice note / image / document — AI can't process it. Hand off to the
  //    marketer SILENTLY. The lead just gets a brief, natural human-sounding
  //    line (no mention of AI or handoff) while the marketer picks it up.
  if (isMedia && !text) {
    await handOff('sent a voice note or file')
    const first = (lead?.full_name || '').split(' ')[0]
    await sendWhatsAppText(phone, first ? `Give me a moment, ${first} 🙏` : `Give me a moment 🙏`, marketer?.id || null).catch(() => {})
    return NextResponse.json({ ok: true, handoff: 'media' })
  }

  // 2) Lead already handled by a human — don't let the AI butt in.
  // A quiet handover means the marketer has moved on — let the assistant pick
  // it back up rather than leaving the lead waiting. Handoffs raised because
  // the assistant was out of its depth stay with the human.
  let paused = !!lead?.ai_paused
  if (paused && lead?.id) {
    const resumed = await maybeResumeAI(lead.id)
    if (resumed) paused = false
  }

  if (paused) {
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

  // 3) Lead explicitly wants a person, or is frustrated → hand off SILENTLY.
  //    The lead must NOT know it was ever an AI, so we send a brief natural
  //    holding line (or nothing) and let the marketer continue as themselves.
  if (asksForHuman || frustrated) {
    await handOff(asksForHuman ? 'asked to speak with someone' : 'seems frustrated')
    const first = (lead?.full_name || '').split(' ')[0]
    await sendWhatsAppText(phone, first ? `One moment, ${first} — let me check on this for you.` : `One moment — let me check on this for you.`, marketer?.id || null).catch(() => {})
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

  // If we have no record of this conversation, the person is replying to
  // something said outside the system — we cannot see it, so answering would be
  // guessing. Hand it to the marketer instead of inventing context.
  if (history.length === 0 && lead?.id) {
    await sb.from('leads').update({
      ai_paused: true, needs_human: true,
      needs_human_at: new Date().toISOString(),
      ai_paused_at: new Date().toISOString(),
      ai_paused_by: 'unknown_history',
    }).eq('id', lead.id).then(() => {}, () => {})

    if (lead.assigned_to) {
      await sb.from('notifications').insert({
        user_id: lead.assigned_to, type: 'handoff',
        title: 'A lead messaged — no chat history',
        body: `${lead.full_name || phone}: "${String(text).slice(0, 90)}" — this conversation started outside the system, so please reply yourself.`,
        link: `/marketer/leads/${lead.id}`,
      }).then(() => {}, () => {})
      const { data: m } = await sb.from('profiles').select('phone').eq('id', lead.assigned_to).maybeSingle()
      if (m?.phone) {
        try { await sendSMS(m.phone, `CCE: ${lead.full_name || phone} messaged on WhatsApp but there's no chat history, so please reply to them yourself.`) } catch {}
      }
    }
    await sb.from('ai_conversations').insert({
      phone, lead_id: lead.id, marketer_id: lead.assigned_to || null,
      incoming_text: text, reply_text: null, answered_by: 'handoff_no_history',
    }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, handoff: 'no_history' })
  }

  // Generate the AI reply
  const reply = await generateAssistantReply(text, {
    leadName: lead?.full_name,
    profession: (lead as any)?.profession || null,
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

  // If the assistant said it would check, that is an escalation — a human must
  // actually follow up, or the lead is left waiting on a promise nobody keeps.
  const deferred = reply && /(come right back|let me (check|confirm|find out)|i'?ll (check|confirm|find out|get back)|get back to you|not sure|don'?t have that|can'?t confirm|will confirm)/i.test(reply)
  if (deferred) {
    try {
      await sb.from('leads').update({
        needs_human: true, needs_human_at: new Date().toISOString(),
      }).eq('id', lead.id).then(() => {}, () => {})
      if (lead.assigned_to) {
        await sb.from('notifications').insert({
          user_id: lead.assigned_to, type: 'handoff',
          title: 'Question needs a real answer',
          body: `${lead.full_name || phone} asked: "${String(text).slice(0, 90)}" — the assistant said it would check. Please reply.`,
          link: `/marketer/leads/${lead.id}`,
        }).then(() => {}, () => {})
        const { data: mp } = await sb.from('profiles').select('phone, full_name').eq('id', lead.assigned_to).maybeSingle()
        if (mp?.phone) {
          try { await sendSMS(mp.phone, `CCE: ${lead.full_name || phone} asked something the assistant could not answer. Please reply on WhatsApp.`) } catch {}
        }
      }
    } catch {}
  }

  // Read what the conversation revealed and update the lead itself: what they
  // do, how warm they are, and when they asked to be contacted. This is what
  // moves a lead to "follow up" without a marketer touching it.
  if (lead?.id && reply) {
    try {
      const read = await readConversation(history, text)
      if (read) {
        const update: Record<string, any> = {}
        if (read.profession && !(lead as any).profession) update.profession = read.profession
        if (read.summary) update.ai_summary = read.summary
        if (read.followUpAt) update.follow_up_at = new Date(read.followUpAt + 'T09:00:00').toISOString()
        // Never downgrade a lead that already registered
        if (read.status && (lead as any).status !== 'registered') update.status = read.status
        if (Object.keys(update).length) {
          update.updated_at = new Date().toISOString()
          await sb.from('leads').update(update).eq('id', lead.id).then(() => {}, () => {})
          if (read.status === 'interested' && lead.assigned_to) {
            await sb.from('notifications').insert({
              user_id: lead.assigned_to, type: 'lead',
              title: 'Lead is ready to register',
              body: `${lead.full_name}: ${read.summary || 'showed strong interest'}`,
              link: `/marketer/leads/${lead.id}`,
            }).then(() => {}, () => {})
          }
        }
      }
    } catch {}
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

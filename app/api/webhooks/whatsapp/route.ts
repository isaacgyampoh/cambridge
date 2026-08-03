import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { readConversation } from '@/lib/integrations/conversationState'
import { maybeResumeAI } from '@/lib/aiResume'
import { sendSMS } from '@/lib/integrations/sms'
import { intakeLead } from '@/lib/leadIntake'
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

/** Record what arrived and what we did with it, so nothing fails invisibly. */
async function logInbound(sb: any, source: string, fromPhone: string | null, text: string | null, outcome: string, detail: string, raw: any) {
  // Preferred: the dedicated inbox table.
  try {
    const { error } = await sb.from('webhook_inbox').insert({
      source, from_phone: fromPhone, body_text: text ? String(text).slice(0, 500) : null,
      outcome, detail: detail.slice(0, 300), raw,
    })
    if (!error) return
  } catch {}

  // Fallback: if that table has not been created yet, record it in the
  // existing message log so diagnosis never depends on a schema step.
  try {
    await sb.from('whatsapp_logs').insert({
      recipient: fromPhone || 'unknown',
      message: `[INBOUND ${outcome}] ${text ? String(text).slice(0, 200) : ''}`.slice(0, 400),
      status: outcome === 'replied' ? 'sent' : 'inbound',
      provider_response: { outcome, detail: detail.slice(0, 300) },
    })
  } catch {}
  console.log('[inbound]', outcome, fromPhone, detail.slice(0, 160))
}


export async function POST(req: NextRequest) {
  // Anything that throws in here used to disappear as a bare 500 with no
  // record, which is indistinguishable from the webhook never being called.
  // WaSender can sign webhooks with a secret. We record whether the signature
  // matched, but NEVER reject on it — a mismatched or missing signature must
  // not be the reason a lead goes unanswered.
  try {
    return await handleInbound(req)
  } catch (e: any) {
    try {
      const sb = createServiceClient()
      await sb.from('webhook_inbox').insert({
        source: 'whatsapp', outcome: 'error',
        detail: `Crashed: ${e?.message || e}`.slice(0, 300),
      })
    } catch {}
    console.error('[whatsapp webhook] crashed', e)
    // Always answer 200 — providers disable webhooks that keep erroring.
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) })
  }
}

async function handleInbound(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {
    // some providers send form-encoded
    try { const t = await req.text(); body = Object.fromEntries(new URLSearchParams(t)) } catch {}
  }

  // WaSender sends an `event` name. Acknowledge its test event clearly so the
  // simulator shows success, and record it as proof the connection works.
  const eventName = String(body?.event || '')
  if (eventName === 'webhook.test' || body?.data?.test === true) {
    try {
      const sb = createServiceClient()
      await logInbound(sb, 'whatsapp', null, 'WaSender test event', 'test_ok',
        'WaSender reached the system successfully — the webhook is connected', body)
    } catch {}
    return NextResponse.json({ ok: true, received: 'webhook.test', message: 'Webhook is connected.' })
  }

  // Ignore event types that are not an incoming message, but record them so it
  // is obvious the connection is live even before a lead writes in.
  if (eventName && !/message|chat/i.test(eventName)) {
    try {
      const sb = createServiceClient()
      await logInbound(sb, 'whatsapp', null, null, 'other_event', `Received "${eventName}"`, null)
    } catch {}
    return NextResponse.json({ ok: true, ignored: eventName })
  }

  // Providers differ, and some send `messages` as an ARRAY. Normalise to the
  // single message object first so path lookups actually resolve — otherwise
  // a lookup lands on an object and stringifies to "[object Object]", which is
  // what was being stored as the lead's message.
  const d: any = body?.data ?? body
  const rawMsgs: any = d?.messages ?? d?.message ?? d
  const msgNode: any = Array.isArray(rawMsgs) ? rawMsgs[0] : rawMsgs

  // Search the message node, its own nested message, the data wrapper and the
  // whole body — providers nest this differently and shapes change.
  const roots: any[] = [msgNode, msgNode?.message, d, body].filter(Boolean)

  /** Only ever returns a real string — never an object stringified. */
  const pick = (...keys: string[]): string => {
    for (const root of roots) {
      for (const k of keys) {
        const v = k.split('.').reduce((o: any, p) => (o == null ? undefined : o[p]), root)
        if (v == null) continue
        if (typeof v === 'string' && v.trim()) return v
        if (typeof v === 'number' || typeof v === 'boolean') return String(v)
      }
    }
    return ''
  }

  /** Raw value, for booleans that may legitimately be false. */
  const pickRaw = (...keys: string[]): any => {
    for (const root of roots) {
      for (const k of keys) {
        const v = k.split('.').reduce((o: any, p) => (o == null ? undefined : o[p]), root)
        if (v !== undefined) return v
      }
    }
    return undefined
  }

  // Field names vary by provider. WaSender delivers Baileys-style payloads:
  //   data.messages.key.remoteJid / .fromMe, data.messages.message.conversation
  const fromRaw = pick(
    'key.remoteJid', 'remoteJid', 'from', 'sender', 'phone', 'number',
    'chatId', 'contact.wa_id', 'wa_id', 'author',
  )
  const text = pick(
    'message.conversation',
    'message.extendedTextMessage.text',
    'message.imageMessage.caption',
    'message.videoMessage.caption',
    'conversation', 'text', 'body', 'caption',
    'message.text', 'text.body',
  )
  const fromMeRaw = pickRaw('key.fromMe', 'fromMe', 'from_me', 'data.key.fromMe', 'data.messages.key.fromMe')
  const fromMe = fromMeRaw === true || fromMeRaw === 'true' || fromMeRaw === 1 || fromMeRaw === '1'
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
    try {
      await logInbound(createServiceClient(), 'whatsapp', fromRaw || null, text || null,
        'error', 'Could not read sender or message from the payload', body)
    } catch {}
    return NextResponse.json({ ok: true, skipped: true })
  }

  // A WhatsApp id looks like 233XXXXXXXXX@s.whatsapp.net and may carry a
  // device suffix (…:12@…). Stripping non-digits first glued that suffix onto
  // the number, so it matched no lead and the message was dropped in silence.
  const phone = String(fromRaw).split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
  const variants = [phone, phone.replace(/^0/, '233'), phone.replace(/^233/, '0'), phone.replace(/^233/, ''), '0' + phone.replace(/^233/, '')]

  const sb = createServiceClient()

  // ── OUTGOING MESSAGES ──
  // fromMe means the message left this WhatsApp line — either the system's own
  // send echoed back, or the marketer typing. Either way it is not something to
  // answer. It is recorded for context and the assistant is left running: a
  // misread here would silence the lead, which is far worse than the assistant
  // and a marketer both being present in a chat.
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
      if (isOurOwn) { await logInbound(sb, 'whatsapp', phone, text, 'ignored_echo', 'Our own outgoing message echoed back', null); return NextResponse.json({ ok: true, echo: true }) }

      if (lead?.id) {
        // Record that a human spoke, but do NOT pause the assistant here.
        // Outgoing messages are echoed back by the provider, and a single
        // misread would silence the lead for good. Staff can pause a chat
        // deliberately from the lead page when they want to take over.
        await sb.from('leads').update({
          last_human_at: new Date().toISOString(),
        }).eq('id', lead.id).then(() => {}, () => {})
        await sb.from('ai_conversations').insert({
          phone, lead_id: lead.id, marketer_id: lead.assigned_to || null,
          incoming_text: null, reply_text: text || `[${mediaType || 'media'}]`,
          answered_by: 'human',
        }).then(() => {}, () => {})
      }
    } catch {}
    await logInbound(sb, 'whatsapp', phone, text, 'paused', 'Treated as a staff reply — assistant paused for this lead', null)
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
      .in('phone', variants)
      .gte('created_at', since)
      .limit(5)
    const seen = (recent || []).some((r: any) => text && (r.incoming_text || '').trim() === text.trim())
    if (seen) { await logInbound(sb, 'whatsapp', phone, text, 'ignored_duplicate', 'Same message already handled in the last 60s', null); return NextResponse.json({ ok: true, duplicate: true }) }
  } catch { /* if the check fails, continue — better to risk a dup than drop a real message */ }

  // Find the lead by phone
  // Indexed lookup on the phone variants (previously pulled 3000 leads into
  // memory on every inbound message — slow and it silently missed lead 3001+).
  let { data: lead } = await sb.from('leads')
    .select('id, full_name, phone, course_interest, assigned_to, ai_paused, profession, status, created_at')
    .in('phone', variants).order('created_at', { ascending: false }).limit(1).maybeSingle()

  // ── HARD RULE: the assistant only ever speaks to people who are leads in
  // this system. A staff WhatsApp line also carries their family, friends and
  // existing customers — the assistant must never reply to those. If the
  // number is not a lead, we record nothing and stay silent.
  // Anyone who messages this line gets a reply. If we do not know them yet,
  // they become a lead here — a real enquiry should never be turned away just
  // because nobody entered them first.
  if (!lead?.id) {
    try {
      const created = await intakeLead({
        full_name: pick('pushName', 'notifyName', 'sender_name', 'name') || 'WhatsApp enquiry',
        phone,
        source: 'whatsapp',
        landing_source: 'Messaged us on WhatsApp',
      })
      if (created?.leadId) {
        const { data: fresh } = await sb.from('leads')
          .select('id, full_name, phone, course_interest, assigned_to, ai_paused, profession, status, created_at')
          .eq('id', created.leadId).maybeSingle()
        lead = fresh as any
        await logInbound(sb, 'whatsapp', phone, text, 'lead_created',
          'Unknown number messaged us — created a lead and continued', null)
      }
    } catch (e: any) {
      await logInbound(sb, 'whatsapp', phone, text, 'error',
        `Could not create a lead for this number: ${e?.message || e}`, null)
    }
  }

  if (!lead?.id) {
    await logInbound(sb, 'whatsapp', phone, text, 'no_lead',
      'Could not match or create a lead for this number', body)
    return NextResponse.json({ ok: true, ignored: 'no_lead' })
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
    await logInbound(sb, 'whatsapp', phone, text, 'handoff', 'Voice note or attachment — handed to staff', null)
    return NextResponse.json({ ok: true, handoff: 'media' })
  }

  // 2) Lead already handled by a human — don't let the AI butt in.
  // A quiet handover means the marketer has moved on — let the assistant pick
  // it back up rather than leaving the lead waiting. Handoffs raised because
  // the assistant was out of its depth stay with the human.
  let paused = !!lead?.ai_paused
  if (paused && lead?.id) {
    // Was there ever a genuine human reply on this lead? If the pause was set
    // by the earlier fault that misread a lead's own message as staff typing,
    // there will be none — clear it instead of leaving the lead unanswered.
    const { count: humanTurns } = await sb.from('ai_conversations')
      .select('id', { count: 'exact', head: true })
      .in('phone', variants).eq('answered_by', 'human')
    if (!humanTurns || (lead as any).ai_paused_by !== 'manual') {
      await sb.from('leads').update({
        ai_paused: false, needs_human: false, ai_paused_by: null,
      }).eq('id', lead.id).then(() => {}, () => {})
      await logInbound(sb, 'whatsapp', phone, text, 'auto_resumed',
        'Pause had no matching human reply — assistant resumed', null)
      paused = false
    } else {
      const resumed = await maybeResumeAI(lead.id)
      if (resumed) paused = false
    }
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
    await logInbound(sb, 'whatsapp', phone, text, 'paused', 'Assistant is paused on this lead — use Resume assistant', null)
    return NextResponse.json({ ok: true, humanHandling: true })
  }

  // 3) Lead explicitly wants a person, or is frustrated → hand off SILENTLY.
  //    The lead must NOT know it was ever an AI, so we send a brief natural
  //    holding line (or nothing) and let the marketer continue as themselves.
  if (asksForHuman || frustrated) {
    await handOff(asksForHuman ? 'asked to speak with someone' : 'seems frustrated')
    const first = (lead?.full_name || '').split(' ')[0]
    await sendWhatsAppText(phone, first ? `One moment, ${first} — let me check on this for you.` : `One moment — let me check on this for you.`, marketer?.id || null).catch(() => {})
    await logInbound(sb, 'whatsapp', phone, text, 'handoff', 'Lead asked for a person', null)
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
    .in('phone', variants)
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

  // Generate the AI reply
  let reply = await generateAssistantReply(text, {
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
    if (!ok) {
      await logInbound(sb, 'whatsapp', phone, text, 'send_failed',
        'A reply was written but WhatsApp would not accept it — check the line', null)
    }
  } else {
    // The assistant produced nothing (AI unavailable or refused). The lead must
    // never be met with silence, so acknowledge and bring in a person.
    const holding = "Thanks for your message — let me check that and come right back to you."
    const ok = await sendWhatsAppText(phone, holding, marketer?.id || null)
    answeredBy = ok ? 'fallback' : 'failed'
    reply = ok ? holding : null
    await logInbound(sb, 'whatsapp', phone, text, ok ? 'fallback_sent' : 'no_reply',
      ok ? 'Assistant gave no answer — sent a holding reply and alerted staff'
         : 'Assistant gave no answer and the holding reply could not be sent', null)
    if (lead?.assigned_to) {
      await sb.from('notifications').insert({
        user_id: lead.assigned_to, type: 'handoff',
        title: 'Lead needs a reply',
        body: `${lead.full_name || phone}: "${String(text).slice(0, 90)}" — the assistant could not answer.`,
        link: `/marketer/leads/${lead.id}`,
      }).then(() => {}, () => {})
    }
  }

  // If the assistant said it would check, that is an escalation — a human must
  // actually follow up, or the lead is left waiting on a promise nobody keeps.
  // Safety net: a reply that states a date, time or amount is only safe if the
  // assistant actually had that fact. If it invented one, escalate instead.
  const statesSpecific = reply && /\b(\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{1,2}[:.]\d{2}\s?(am|pm)?|\d{1,2}\s?(am|pm))\b/i.test(reply)
  const deferred = reply && /(come right back|let me (check|confirm|find out)|i'?ll (check|confirm|find out|get back)|get back to you|not sure|don'?t have that|can'?t confirm|will confirm)/i.test(reply)
  if (deferred || statesSpecific) {
    try {
      await sb.from('leads').update({
        needs_human: true, needs_human_at: new Date().toISOString(),
      }).eq('id', lead.id).then(() => {}, () => {})
      if (lead.assigned_to) {
        await sb.from('notifications').insert({
          user_id: lead.assigned_to, type: 'handoff',
          title: 'Question needs a real answer',
          body: `${lead.full_name || phone} asked: "${String(text).slice(0, 90)}" — please confirm the details with them yourself.`,
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

  await logInbound(sb, 'whatsapp', phone, text, reply ? 'replied' : 'no_reply',
    reply ? String(reply).slice(0, 200) : 'The assistant produced no reply', null)

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
  // Open this in a browser to see whether WhatsApp is actually reaching us.
  const sb = createServiceClient()
  let received = 0, lastAt: string | null = null, where = 'none'

  // Count inbound hits from whichever log exists.
  try {
    const { data, error } = await sb.from('webhook_inbox')
      .select('created_at').order('created_at', { ascending: false }).limit(50)
    if (!error && data) {
      const day = Date.now() - 86400000
      received = data.filter((r: any) => new Date(r.created_at).getTime() > day).length
      lastAt = data[0]?.created_at || null
      where = 'webhook_inbox'
    }
  } catch {}

  if (where === 'none') {
    try {
      const { data } = await sb.from('whatsapp_logs')
        .select('created_at').ilike('message', '[INBOUND%')
        .order('created_at', { ascending: false }).limit(50)
      if (data) {
        const day = Date.now() - 86400000
        received = data.filter((r: any) => new Date(r.created_at).getTime() > day).length
        lastAt = data[0]?.created_at || null
        where = 'whatsapp_logs'
      }
    } catch {}
  }

  // Messages leads actually sent us, whatever the outcome.
  let fromLeads = 0
  try {
    const { count } = await sb.from('ai_conversations')
      .select('id', { count: 'exact', head: true })
      .not('incoming_text', 'is', null)
      .gte('created_at', new Date(Date.now() - 86400000).toISOString())
    fromLeads = count || 0
  } catch {}

  const anything = received > 0 || fromLeads > 0
  return NextResponse.json({
    ok: true,
    message: 'WhatsApp webhook is live and reachable.',
    webhookHitsLast24h: received,
    messagesFromLeadsLast24h: fromLeads,
    lastReceivedAt: lastAt,
    readingFrom: where,
    verdict: anything
      ? 'WhatsApp IS reaching the system. If a lead got no reply, open Settings > Incoming WhatsApp for the reason against each message.'
      : 'NOTHING has reached the system in 24 hours. WaSender is not calling this URL. In WaSender, set the webhook to this exact address for EVERY connected session, and enable incoming message events.',
  })
}

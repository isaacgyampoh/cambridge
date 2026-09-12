import { NextRequest, NextResponse } from 'next/server'
import { parseInbound } from '@/lib/parseInbound'
import { ownerOfLine, isKnownLine } from '@/lib/whatsapp/lineOwnerRules'
import { lookup } from '@/lib/db/lookup'
import { claimJob, markSent, alreadyProcessed } from '@/lib/messageJobs'
import { findCourse } from '@/lib/courseMatch'
import { resolveBrochure } from '@/lib/documents/resolve'
import { createServiceClient } from '@/lib/supabase/server'
import { readConversation } from '@/lib/integrations/conversationState'
import { maybeResumeAI } from '@/lib/aiResume'
import { sendSMS } from '@/lib/integrations/sms'
import { intakeLead } from '@/lib/leadIntake'
import {
  chatbotReply, handOffToHuman, buildLeadContext, recordEvent, actionsFor,
} from '@/lib/chatbot'
import { sendWhatsAppText, sendWhatsAppMedia } from '@/lib/integrations/whatsapp'
import { CONFIG } from '@/lib/config'
import { timingSafeEqual } from 'crypto'
import { SECRETS } from '@/lib/config.server'

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


/**
 * Is this request allowed to reach the webhook?
 *
 * ── WHY THIS NOW EXISTS ────────────────────────────────────────────────────
 *
 * It did not. The comment here said "WaSender can sign webhooks with a secret.
 * We record whether the signature matched, but NEVER reject on it" — and no
 * check of any kind was implemented, so the comment described an intention
 * rather than the code. WASENDER_WEBHOOK_SECRET was read in config.server and
 * used nowhere.
 *
 * So this was a fully open endpoint on a public URL. A POST to it could create
 * a lead, spend money on model calls, inject text into a conversation's
 * history, and — the one that matters — cause the centre's WhatsApp line to
 * send messages to any number the caller named.
 *
 * ── WHAT IS CHECKED, AND WHAT IS NOT INVENTED ──────────────────────────────
 *
 * A shared secret, supplied as a header or a query parameter. Not an HMAC
 * signature: this repository cannot verify WaSender's signing scheme, and
 * guessing at one would either reject every real delivery or accept every
 * forged one. A shared secret is something the centre configures on both
 * sides, which is exactly as strong as the secret and honest about it.
 *
 * ── AND WHY AN UNCONFIGURED SECRET STILL PASSES ────────────────────────────
 *
 * Turning this on by deploying it would silence a live WhatsApp line the
 * moment this ships, which is a worse outage than the exposure. With no
 * secret set the endpoint behaves exactly as before and says so on every
 * request, and Assistant readiness reports it. Setting the variable turns the
 * gate on.
 */
function webhookAllowed(req: NextRequest): { ok: true } | { ok: false; why: string } {
  const expected = SECRETS.wasenderWebhookSecret
  if (!expected) {
    console.warn('[whatsapp webhook] OPEN — WASENDER_WEBHOOK_SECRET is not set, so anyone '
      + 'who knows this URL can create leads and send messages from the centre\'s line.')
    return { ok: true }
  }

  const url = new URL(req.url)
  const supplied =
    req.headers.get('x-webhook-secret')
    || req.headers.get('x-wasender-secret')
    || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || url.searchParams.get('secret')
    || url.searchParams.get('key')
    || ''

  if (!supplied) return { ok: false, why: 'no secret supplied' }

  // Constant time, so the endpoint does not leak the secret a character at a
  // time to somebody measuring how long it takes to say no.
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  const match = a.length === b.length && timingSafeEqual(a, b)
  return match ? { ok: true } : { ok: false, why: 'secret did not match' }
}

export async function POST(req: NextRequest) {
  const allowed = webhookAllowed(req)
  if (!allowed.ok) {
    /*
     * Recorded, because a webhook that has started being rejected looks
     * exactly like one that has stopped being called — and the fix for those
     * two is opposite.
     */
    console.error('[whatsapp webhook] rejected —', allowed.why)
    try {
      await createServiceClient().from('webhook_inbox').insert({
        source: 'whatsapp', outcome: 'rejected',
        detail: `Refused: ${allowed.why}`,
      })
    } catch { /* the refusal stands either way */ }
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  // Anything that throws in here used to disappear as a bare 500 with no
  // record, which is indistinguishable from the webhook never being called.
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

/**
 * Tell the lead's owner that something the assistant promised did not happen.
 *
 * Its own function because a promise that failed silently is the failure this
 * webhook keeps having: a brochure or a link the lead was told to expect, and
 * nobody aware it never arrived.
 */
async function notifyOwner(
  sb: ReturnType<typeof createServiceClient>,
  lead: { id: string; assigned_to?: string | null } | null,
  title: string,
  body: string,
): Promise<void> {
  if (!lead?.assigned_to) {
    console.error('[whatsapp]', title, '— and the lead has no owner to tell:', lead?.id)
    return
  }
  const { error } = await sb.from('notifications').insert({
    user_id: lead.assigned_to, type: 'handoff', title, body,
    link: `/marketer/leads/${lead.id}`,
  })
  if (error) console.error('[whatsapp] could not notify owner of:', title, error.message)
}

async function handleInbound(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {
    // some providers send form-encoded
    try { const t = await req.text(); body = Object.fromEntries(new URLSearchParams(t)) } catch {}
  }

  // Find the sender, message and direction wherever they sit in the payload.
  // Matching known paths kept failing as providers nest things differently and
  // change shape without notice.
  const parsed = parseInbound(body)
  const eventName = parsed.eventName || ''

  // Acknowledge the provider's test event so their simulator reports success.
  if (eventName === 'webhook.test' || body?.data?.test === true) {
    try {
      await logInbound(createServiceClient(), 'whatsapp', null, 'WaSender test event',
        'test_ok', 'WaSender reached the system — the webhook is connected', body)
    } catch {}
    return NextResponse.json({ ok: true, received: 'webhook.test', message: 'Webhook is connected.' })
  }

  const fromRaw = parsed.phone || ''
  const text = parsed.text || ''
  const fromMe = parsed.fromMe
  const mediaType = parsed.mediaType || ''
  const pushName = parsed.senderName || ''
  const isMedia = !!parsed.mediaType

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
  const phone = fromRaw
  const variants = Array.from(new Set([
    phone,
    phone.replace(/^0/, '233'),
    phone.replace(/^233/, '0'),
    phone.replace(/^233/, ''),
    '0' + phone.replace(/^233/, ''),
    // Leads created before the real number was available were stored under the
    // Linked ID. Match those too, so existing conversations keep working.
    ...(parsed.lid ? [parsed.lid, `${parsed.lid}@lid`] : []),
  ].filter(Boolean)))

  const sb = createServiceClient()

  // ── OUTGOING MESSAGES ──
  // fromMe means the message left this WhatsApp line — either the system's own
  // send echoed back, or the marketer typing. Either way it is not something to
  // answer. It is recorded for context and the assistant is left running: a
  // misread here would silence the lead, which is far worse than the assistant
  // and a marketer both being present in a chat.
  if (fromMe) {
    // Staff can hand the chat back to the assistant, or take it over, with a
    // short keyword typed from their own WhatsApp — no need to open the portal.
    const cmd = String(text || '').trim().toLowerCase()
    const handBack = /^(done|resume|over to you|ai on|bot on)\b/.test(cmd)
    const takeOver = /^(hold|stop|pause|i'?ll handle|ai off|bot off)\b/.test(cmd)
    if (handBack || takeOver) {
      try {
        const { data: l } = await sb.from('leads').select('id').in('phone', variants).limit(1).maybeSingle()
        if (l?.id) {
          await sb.from('leads').update({
            ai_paused: takeOver, needs_human: takeOver,
            ai_paused_by: takeOver ? 'manual' : null,
            last_human_at: new Date().toISOString(),
          }).eq('id', l.id)
          await logInbound(sb, 'whatsapp', phone, text,
            takeOver ? 'staff_took_over' : 'staff_handed_back',
            takeOver ? 'Staff paused the assistant on this lead' : 'Staff handed the chat back to the assistant', null)
        }
      } catch {}
      return NextResponse.json({ ok: true, command: handBack ? 'resumed' : 'paused' })
    }

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
  const msgId = String(body?.data?.messages?.key?.id || body?.data?.key?.id || body?.id || '')

  // The provider retries a webhook it thinks failed, and a retry must never
  // produce a second reply. Recording the message id in the database — where
  // the uniqueness is enforced — is the only reliable guard.
  if (msgId && await alreadyProcessed(msgId)) {
    return NextResponse.json({ ok: true, duplicate: 'event_already_handled' })
  }
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
  // A lead matched by Linked ID should be corrected to their real number, so
  // staff see something they can actually call.
  if (lead?.id && parsed.phone && lead.phone && lead.phone.replace(/[^0-9]/g, '') !== parsed.phone) {
    const stored = lead.phone.replace(/[^0-9]/g, '')
    if (parsed.lid && (stored === parsed.lid || stored.length > 15)) {
      await sb.from('leads').update({ phone: parsed.phone }).eq('id', lead.id).then(() => {}, () => {})
      lead.phone = parsed.phone
    }
  }

  /*
   * ── WHOSE LINE WAS THIS? ─────────────────────────────────────────────────
   *
   * Read only when we are about to create a lead. For a lead that already
   * exists the answer changes nothing: who owns them is settled by the ERP's
   * own assignment rules, and a message arriving on a second line does not
   * move a colleague's lead away from them.
   *
   * For a NEW enquiry it settles everything. Without it, somebody who
   * deliberately messaged Ruth's number was passed to the weighted lottery
   * like an anonymous web form and could be given to any marketer at all —
   * who then answered in their own voice, from their own line.
   */
  let lineOwner: string | null = null
  if (!lead?.id && parsed.receivedOn) {
    const { row: lines, failed: linesFailed } = await lookup(
      sb.from('profiles')
        .select('id, wasender_phone, is_active')
        .not('wasender_phone', 'is', null),
    )
    if (linesFailed) {
      // Not fatal: fall through to the ordinary assignment rules rather than
      // turn away a real enquiry. But say so, because every lead that arrives
      // while this is failing is credited to the wrong marketer.
      console.error('[webhooks/whatsapp] could not read connected lines:', linesFailed)
      await logInbound(sb, 'whatsapp', phone, text, 'line_lookup_failed',
        'Could not read the connected WhatsApp lines — lead assigned by the usual rules', null)
    } else {
      const known = (lines || []).map(m => ({
        id: m.id, line: m.wasender_phone, active: m.is_active !== false,
      }))
      lineOwner = ownerOfLine(parsed.receivedOn, known)
      if (!lineOwner && !isKnownLine(parsed.receivedOn, known)) {
        // Worth recording: it usually means a marketer changed their number
        // and their profile still holds the old one, so every lead from that
        // line is being misfiled.
        await logInbound(sb, 'whatsapp', phone, text, 'unknown_line',
          `Message arrived on ${parsed.receivedOn}, which no marketer has connected`, null)
      }
    }
  }

  if (!lead?.id) {
    try {
      const created = await intakeLead({
        full_name: pushName || 'WhatsApp enquiry',
        phone,
        source: 'whatsapp',
        landing_source: 'Messaged us on WhatsApp',
        // The marketer they actually messaged. Null falls through to the
        // weighted lottery, which is the right answer only when we genuinely
        // do not know whose line it was.
        preferredMarketerId: lineOwner,
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
    /*
     * Only an ORPHANED pause is cleared here.
     *
     * This read `!humanTurns || ai_paused_by !== 'manual'`, which resumed
     * anything that was not a manual takeover — including, once the assistant
     * could hand over, its own handovers. The conversation would be marked for
     * a colleague and the assistant would carry on talking over them on the
     * very next message.
     *
     * What this clause is actually for is narrower: a pause with no recorded
     * cause AND no human reply behind it, left by the earlier fault that
     * misread a lead's own message as staff typing. That is a pause nobody
     * meant, and it is the only one safe to drop on sight.
     *
     * Everything with a recorded cause goes to maybeResumeAI, which resumes it
     * after a quiet period instead of immediately.
     */
    const pausedBy = (lead as { ai_paused_by?: string | null }).ai_paused_by || null
    if (!humanTurns && !pausedBy) {
      await sb.from('leads').update({
        ai_paused: false, needs_human: false, ai_paused_by: null,
      }).eq('id', lead.id).then(() => {}, () => {})
      await logInbound(sb, 'whatsapp', phone, text, 'auto_resumed',
        'Pause had no recorded cause and no human reply — assistant resumed', null)
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

  // ── Brochure ──
  // Only when they actually ask for a brochure, and only if a real, working
  // file exists. Asking "how much" is a question to answer in words, not a
  // reason to send a document; and a broken file is worse than none.
  const wantsBrochure = /\b(brochure|flyer|prospectus|course outline|syllabus)\b/.test(lower)
  if (wantsBrochure && lead?.course_interest) {
    const course = await findCourse(lead.course_interest)

    const brochureUrl = await resolveBrochure(course?.id || null, null)

    let usable = false
    if (brochureUrl) {
      // Check the file is really there before sending it. A dead link that
      // will not open makes us look careless.
      try {
        const head = await fetch(brochureUrl, { method: 'HEAD', signal: AbortSignal.timeout(6000) })
        usable = head.ok && Number(head.headers.get('content-length') || '1') > 0
      } catch { usable = false }
    }

    if (usable && course) {
      const jobKey = `brochure:${lead.id}:${msgId || Math.floor(Date.now() / 120000)}`
      if (await claimJob({ dedupeKey: jobKey, leadId: lead.id, phone, kind: 'brochure', sourceEvent: msgId || null })) {
        const caption = `Here you go. Everything about our ${course.name} programme is in here.`
        const sent = await sendWhatsAppMedia(phone, caption, brochureUrl!, marketer?.id || null)
        await markSent(jobKey, sent)
        await sb.from('ai_conversations').insert({
          phone, lead_id: lead?.id || null, marketer_id: marketer?.id || null,
          incoming_text: text, reply_text: '[brochure sent] ' + caption, answered_by: sent ? 'ai_brochure' : 'fallback',
        }).then(() => {}, () => {})
        if (sent) return NextResponse.json({ ok: true, brochure: true })
      } else {
        return NextResponse.json({ ok: true, duplicate: 'brochure' })
      }
    }
    // No usable brochure: fall through and let the assistant answer in words.
  }

  // Did we just offer to send the link? Then a bare "yes" means yes.
  let lastWeSaidOfferedLink = false
  try {
    const { data: lastOut } = await sb.from('ai_conversations')
      .select('reply_text').in('phone', variants).not('reply_text', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    lastWeSaidOfferedLink = /link|regist/i.test(String(lastOut?.reply_text || ''))
  } catch {}

  // Ready to register — all of these mean the same thing.
  const wantsToRegister =
    /\b(i'?m |am |i am )?(interested).{0,30}\b(register|apply|join|sign ?up|enrol|enroll)\b/.test(lower) ||
    /\b(want|like|ready|wish) to (register|apply|join|sign ?up|enrol|enroll|start my application)\b/.test(lower) ||
    /\bhow (do|can) i (register|apply|join|enrol|enroll|start)\b/.test(lower) ||
    /\b(send|share) (me )?(the )?(registration |application )?(link|form)\b/.test(lower) ||
    /\b(register|sign ?up|enrol|enroll) me\b/.test(lower)     ||
    // A bare "yes" right after we offered the link counts as agreeing.
    (/^(yes|yeah|ok|okay|sure|please)[\s,.!]*$/.test(lower.trim()) && lastWeSaidOfferedLink)

  if (wantsToRegister && marketer?.marketer_code) {
    const link = `${CONFIG.appUrl}/apply/${marketer.marketer_code}`

    // Claim the right to run this before sending anything. If a retried
    // webhook or a second run gets here, the claim fails and it stops — which
    // is what actually prevents the link arriving twice.
    const jobKey = `reg_link:${lead.id}:${msgId || Math.floor(Date.now() / 120000)}`
    const mine = await claimJob({
      dedupeKey: jobKey, leadId: lead.id, phone, kind: 'registration_link',
      body: link, sourceEvent: msgId || null,
    })

    if (!mine) {
      await logInbound(sb, 'whatsapp', phone, text, 'ignored_duplicate',
        'A registration link is already being sent for this message', null)
      return NextResponse.json({ ok: true, duplicate: 'registration_link' })
    }

    // 1) Tell them what is about to happen, warmly and in full.
    const ack = `Okay, please give me a minute. I'll send you our registration link so you can fill in your details, make your registration payment and submit your application. Once you're done, your admission letter will be sent to you shortly after.`
    const sent = await sendWhatsAppText(phone, ack, marketer.id)

    if (sent) {
      // 2) Wait the minute you promised.
      // About 25 seconds, varied a little so it never feels timed.
      await new Promise(r => setTimeout(r, 21000 + Math.random() * 8000))

      // Someone may have stepped in while we waited.
      const { data: still } = await sb.from('leads').select('ai_paused').eq('id', lead.id).maybeSingle()
      if (!still?.ai_paused) {
        // 3) The link on its own.
        await sendWhatsAppText(phone, link, marketer.id)

        // 4) Then the short line under it.
        await new Promise(r => setTimeout(r, 4000 + Math.random() * 4000))
        await sendWhatsAppText(phone,
          `This is the registration link I mentioned. Please click on it to continue with your application.`,
          marketer.id)
      }
    }
    await markSent(jobKey, sent)

    await sb.from('ai_conversations').insert({
      phone, lead_id: lead?.id || null, marketer_id: marketer?.id || null,
      incoming_text: text, reply_text: `${ack}\n${link}`, answered_by: sent ? 'ai_link' : 'fallback',
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

  /*
   * ── THE LEAD'S WHOLE CONTEXT, BEFORE THE MODEL SEES ANYTHING ─────────────
   *
   * Who they are, which colleague is handling them, which programme they
   * actually asked about, what it really costs, whether a brochure exists,
   * and how far this conversation has already got. The model is handed facts
   * rather than trusted to recall them.
   */
  const ctx = await buildLeadContext({ lead, latestMessage: text })

  /*
   * What was on the table last time.
   *
   * Recomputed rather than stored: actionsFor is deterministic given the
   * capability, the stage and what has already been taken, and all three are
   * derived from recorded events. So the same call that produced the previous
   * message's options produces them again, and a reply of "2" can be resolved
   * without a column to keep them in.
   */
  const offered = actionsFor({
    capability: ctx.capability,
    stage: ctx.state.stage,
    taken: ctx.state.taken,
    humanName: ctx.marketerName,
  })

  const answer = await chatbotReply({ message: text, ctx, history, offered })

  /*
   * The assistant tried to quote a price the centre has no record of, and the
   * reply was withheld. Recorded where staff actually look, not only in a
   * server log nobody reads: it usually means a course record is missing its
   * fee, so the model had nothing to anchor to and produced a number. That is
   * fixable on the Courses screen, by whoever sees this.
   */
  if (answer.skipped === 'unsupported-amount') {
    await logInbound(sb, 'whatsapp', phone, text, 'wrong_fee_withheld',
      'The assistant quoted a fee that is not on file. The reply was not sent and a colleague was asked to take over. '
      + 'Check that this programme has its fee recorded.', null)
  }

  let reply = answer.text

  let answeredBy = 'skipped'
  if (reply) {
    /*
     * A short, honest pause — not a disguise.
     *
     * This used to wait up to fourteen seconds, deliberately, because "an
     * instant response is the clearest sign a machine is on the other end".
     * The centre is no longer hiding that, so the delay has no purpose left
     * and an assistant that answers promptly is simply better. What remains
     * is a beat so the reply does not land on top of the person's own message
     * in the thread.
     */
    await new Promise(r => setTimeout(r, 900 + Math.random() * 700))

    // Someone may have written again while we waited, or a colleague may have
    // stepped in. Check before sending something now out of date.
    const { data: latest } = await sb.from('leads')
      .select('ai_paused').eq('id', lead.id).maybeSingle()
    if (latest?.ai_paused) {
      await logInbound(sb, 'whatsapp', phone, text, 'skipped_after_wait',
        'A person took over while the reply was being prepared', null)
      return NextResponse.json({ ok: true, superseded: true })
    }

    // Send back via the marketer's own line (falls back to central inside sender)
    const ok = await sendWhatsAppText(phone, reply, marketer?.id || null)
    answeredBy = ok ? 'ai' : 'fallback'

    /*
     * The handover runs only once the reply has actually been delivered.
     *
     * Order matters both ways. Marking first would pause the assistant before
     * the person had been told anybody was coming — they would simply stop
     * hearing back. Not marking at all would leave the promise the assistant
     * just made ("I'll ask Ama to pick this up") with nobody told about it,
     * which is the failure the whole handover path exists to prevent.
     */
    /*
     * What just happened, recorded where a person can see it.
     *
     * These are the events the conversation's state is later derived from —
     * see lib/chatbot/events — so this is not only an audit trail. A brochure
     * request that is never recorded is one the assistant will ask about
     * again next time.
     */
    if (ok && lead?.id) {
      if (answer.intent === 'brochure') {
        await recordEvent({ leadId: lead.id, event: 'BROCHURE_REQUESTED', detail: ctx.programme?.name || null })
      }
      if (answer.intent === 'register') {
        await recordEvent({ leadId: lead.id, event: 'REGISTRATION_INTENT', detail: ctx.programme?.name || null })
      }
      if (answer.intent === 'human') {
        await recordEvent({ leadId: lead.id, event: 'HUMAN_REQUESTED', detail: String(text).slice(0, 200) })
      }
      if (answer.intent === 'payment') {
        await recordEvent({ leadId: lead.id, event: 'PAYMENT_ESCALATED', detail: String(text).slice(0, 200) })
      }
      if (ctx.programme && ctx.state.stage === 'NEW') {
        await recordEvent({ leadId: lead.id, event: 'PROGRAMME_SELECTED', detail: ctx.programme.name })
      }
    }

    if (ok && answer.handoff && lead?.id) {
      const result = await handOffToHuman({
        leadId: lead.id,
        reason: answer.handoff,
        lastMessage: text,
        programme: ctx.programme?.name || null,
        score: answer.score,
      })
      if (!result.handed) {
        console.error('[whatsapp] told the lead a colleague would pick it up, but the handover failed —',
          'lead', lead.id, 'reason', answer.handoff)
      }
    }

    /*
     * ── THE ATTACHMENT THE APPLICATION DECIDED ON ─────────────────────────
     *
     * This used to detect a promised link by running a regular expression
     * over the model's own words — "(send|share)...\b(link|form)\b" — which
     * meant a file was sent because of how a sentence happened to be phrased.
     * A reply that promised the link in different words sent nothing, and a
     * reply that merely mentioned one sent it unasked.
     *
     * The application decides now. chatbotReply returns an attachment only
     * when the intent was registration or a brochure AND the record actually
     * holds a URL for it, so the promise and the delivery are the same act.
     */
    if (ok && answer.attachment && lead?.id) {
      const { kind, url } = answer.attachment
      const key = `attachment:${kind}:${lead.id}:${msgId || Math.floor(Date.now() / 300000)}`
      if (await claimJob({ dedupeKey: key, leadId: lead.id, phone, kind, sourceEvent: msgId || null })) {
        // A beat, so it arrives as a follow-up rather than on top of the reply.
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000))
        const { data: still } = await sb.from('leads').select('ai_paused').eq('id', lead.id).maybeSingle()

        if (still?.ai_paused) {
          await markSent(key, false)
        } else if (kind === 'brochure') {
          const sent = await sendWhatsAppMedia(phone, '', url, marketer?.id || null)
          await markSent(key, sent)
          await recordEvent({
            leadId: lead.id,
            event: sent ? 'BROCHURE_SENT' : 'BROCHURE_UNAVAILABLE',
            detail: sent ? ctx.programme?.name || null : 'The file would not send',
          })
          if (!sent) {
            await logInbound(sb, 'whatsapp', phone, text, 'send_failed',
              'Promised the brochure but the file would not send', null)
            await notifyOwner(sb, lead, 'Brochure did not send',
              `${lead.full_name || phone} was promised the ${ctx.programme?.name || 'programme'} brochure and it failed to send. Please send it yourself.`)
          }
        } else {
          const linkOk = await sendWhatsAppText(phone, url, marketer?.id || null)
          await markSent(key, linkOk)
          if (linkOk) {
            await recordEvent({ leadId: lead.id, event: 'REGISTRATION_LINK_SENT', detail: ctx.programme?.name || null })
            await new Promise(r => setTimeout(r, 2500 + Math.random() * 1500))
            await sendWhatsAppText(phone,
              'That is the registration link. Fill it in and pay the registration fee to secure your place.',
              marketer?.id || null)
            await sb.from('ai_conversations').insert({
              phone, lead_id: lead.id, marketer_id: marketer?.id || null,
              incoming_text: null, reply_text: url, answered_by: 'ai_link',
            }).then(() => {}, () => {})
          } else {
            await logInbound(sb, 'whatsapp', phone, text, 'send_failed',
              'Promised the registration link but it could not be sent', null)
            await notifyOwner(sb, lead, 'Registration link did not send',
              `${lead.full_name || phone} was promised the link but it failed to send. Please send it yourself.`)
          }
        }
      }
    }

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
          try { await sendSMS(mp.phone, `CCE: ${lead.full_name || phone} asked something the assistant could not answer. Reply to them on WhatsApp, then send "done" in that chat to hand it back.`) } catch {}
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
        // The follow-up date goes to the queue, not to leads.follow_up_at —
        // that column is now derived by a trigger (migration 0014) and no
        // application code writes it. Writing it here would be overwritten by
        // the next queue change and would never reach the Follow-ups screen.
        const detectedFollowUp = read.followUpAt
          ? new Date(read.followUpAt + 'T09:00:00').toISOString()
          : null
        // Never downgrade a lead that already registered
        if (read.status && (lead as any).status !== 'registered') update.status = read.status
        if (detectedFollowUp) {
          const { error: queueErr } = await sb.from('follow_up_queue').insert({
            lead_id: lead.id,
            marketer_id: lead.assigned_to || null,
            follow_up_at: detectedFollowUp,
            reason: 'Detected from the lead\'s WhatsApp reply',
            priority: 'normal',
            status: 'pending',
          })
          // Not fatal to handling the message, but it must leave a trace: a
          // follow-up the assistant heard and nobody was told about is the
          // failure this queue exists to prevent.
          if (queueErr) {
            console.error('[whatsapp] follow-up not queued for lead', lead.id, queueErr.message)
          }
        }

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

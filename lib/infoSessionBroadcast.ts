import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendEmail, emailConfigured } from '@/lib/integrations/email'
import { queueSMS } from '@/lib/notifications/sms'
import { normaliseRecipient } from '@/lib/integrations/sms'
import { whatsappConnected, smsConnected } from '@/lib/messaging'
import { lookup } from '@/lib/db/lookup'
import { publicOrigin } from '@/lib/url'

/**
 * Broadcast one info session: SMS / WhatsApp / email every targeted lead,
 * push the link to all marketers, mark it sent. Shared by the scheduled cron
 * runner AND the manual "send now" action so the behaviour is identical.
 */
export async function broadcastInfoSession(sessionId: string) {
  const sb = createServiceClient()
  // As in classReminderBroadcast: a failed read must not be reported as an
  // info session that has already gone out.
  const { row: s, failed } = await lookup(
    sb.from('info_sessions').select('*').eq('id', sessionId).maybeSingle(),
  )
  if (failed) {
    console.error('[infoSessionBroadcast] session read failed:', failed)
    return { error: 'We could not read this session just now. Please try again in a moment.', retryable: true }
  }
  if (!s || s.status !== 'scheduled') return { error: 'Session not found or already sent.' }

  // Audience — include the lead's assigned marketer so their join link is
  // routed through (attributed to) the right person.
  let q: any = sb.from('leads').select('id, full_name, phone, email, assigned_to').not('phone', 'is', null)
  if (s.audience === 'uncontacted') q = q.eq('status', 'new')
  else if (s.audience === 'interested') q = q.in('status', ['interested', 'follow_up'])
  else q = q.not('status', 'in', '(registered,lost,not_interested)')
  const { data: leads } = await q.limit(5000)

  // Marketer codes -> per-lead tracked join links
  const { data: allMarketers } = await sb.from('profiles').select('id, marketer_code').not('marketer_code', 'is', null)
  const codeById: Record<string, string> = {}
  for (const m of allMarketers || []) codeById[m.id] = m.marketer_code
  // One canonical origin, not a third copy of the fallback. See lib/url.ts.
  const appUrl = publicOrigin()
  const trackedFor = (lead: any) => {
    const code = lead.assigned_to ? (codeById[lead.assigned_to] || 'x') : 'x'
    return `${appUrl}/j/${s.id}/${code}?p=${encodeURIComponent(lead.phone)}`
  }

  const when = new Date(s.scheduled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  const wanted = String(s.channels || 'sms,whatsapp').split(',').map((c: string) => c.trim()).filter(Boolean)

  /*
   * ── WHICH CHANNELS CAN ACTUALLY CARRY THIS ───────────────────────────────
   *
   * Asked of the senders, not assumed from what was ticked. With no API key
   * both sendWhatsAppText and sendSMS hand the message to a recording
   * provider that keeps it and answers TRUE — so a session sent with
   * WhatsApp ticked and no WhatsApp configured counted every lead as
   * notified, marked itself sent, and told the operator "Sent to 212 leads".
   * Nobody received anything.
   */
  const usable = {
    sms: wanted.includes('sms') && smsConnected(),
    whatsapp: wanted.includes('whatsapp') && whatsappConnected(),
    email: wanted.includes('email') && emailConfigured(),
  }

  if (!usable.sms && !usable.whatsapp && !usable.email) {
    const asked = wanted.join(', ') || 'none'
    return {
      error: `None of the channels chosen (${asked}) can send from this deployment right now, `
        + 'so nothing was sent and the session is still scheduled.',
      retryable: true,
    }
  }

  /*
   * ── A BUDGET, BECAUSE THIS RUNS IN ONE REQUEST ───────────────────────────
   *
   * Up to five thousand leads were messaged one after another in the request
   * that pressed Send. The platform kills it long before that finishes, with
   * some leads messaged, the session still marked `scheduled`, and no record
   * of where it stopped — so pressing Send again started from the top and
   * texted those people twice.
   *
   * Each text is queued with a key of its own now, so a second run skips
   * anybody already queued and picks up where this one left off. The budget
   * stops the request before the platform does.
   */
  const DEADLINE = Date.now() + 45_000
  let notified = 0        // reached on at least one channel
  let queued = 0          // accepted by the queue, not yet confirmed sent
  let failedSends = 0
  let unreachable = 0     // no usable number or address
  let pending = 0         // left for the next run
  const badNumbers: string[] = []

  for (const lead of leads || []) {
    if (Date.now() > DEADLINE) { pending++; continue }

    const first = (lead.full_name || 'there').split(' ')[0]
    const joinLink = trackedFor(lead)
    const msg = `Hi ${first}, you're invited to Cambridge Center of Excellence's "${s.title}" on ${when}.\nJoin here: ${joinLink}${s.description ? `\n${s.description}` : ''}`

    /*
     * A number the sender would refuse is reported, not dropped. "212 of 260
     * sent" with no word on the other forty-eight is how a list stays wrong
     * for ever.
     */
    const dialable = normaliseRecipient(lead.phone)
    if (!dialable && !(usable.email && lead.email)) {
      unreachable++
      if (lead.phone && badNumbers.length < 50) badNumbers.push(`${lead.full_name || 'Unnamed'}: ${lead.phone}`)
      continue
    }

    let reached = false

    if (usable.whatsapp && dialable) {
      try { reached = Boolean(await sendWhatsAppText(lead.phone, msg, lead.assigned_to || null)) } catch { /* the next channel still runs */ }
    }

    if (usable.sms && dialable && !reached) {
      try {
        /*
         * Through the queue, with one key per lead per session: a retry
         * cannot text anybody twice, a failure is retried by the existing
         * machinery, and every recipient has a row that the Information
         * section can report a real status from.
         */
        const res = await queueSMS({
          to: lead.phone,
          message: msg,
          kind: 'info_session',
          entityId: s.id,
          dedupeKey: `info_session:${s.id}:${lead.id}`,
        })
        if (res.sent) reached = true
        else if (res.duplicate) reached = true      // already sent on an earlier run
        else if (res.queued) queued++
        else failedSends++
      } catch { failedSends++ }
    }

    if (usable.email && lead.email && !reached) {
      try {
        const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#10231C">
          <p style="font-size:15px;line-height:1.6">Hi ${first},</p>
          <p style="font-size:15px;line-height:1.6">You're invited to <b>${s.title}</b> at Cambridge Center of Excellence on <b>${when}</b>.</p>
          ${s.description ? `<p style="font-size:14px;color:#5A6B64;line-height:1.6">${s.description}</p>` : ''}
          <p style="margin:18px 0"><a href="${joinLink}" style="background:#0B3B2E;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600;font-size:14px">Join the session</a></p>
          <p style="font-size:13px;color:#97a1b0">Or copy this link: ${joinLink}</p>
        </div>`
        reached = Boolean(await sendEmail(lead.email, `You're invited: ${s.title} — Cambridge CE`, html,
          `You're invited to ${s.title} on ${when}. Join: ${joinLink}`))
      } catch { /* counted below */ }
    }

    if (reached) notified++
    else if (!queued) failedSends++
  }

  // Push a link to marketers. Each marketer gets THEIR OWN tracked version
  // (/j/{session}/{their_code}) so anyone who joins through their share — even
  // a stranger from their status — is attributed to them, and they can see
  // their own join count. The shared_links row shows a generic version.
  let marketersNotified = 0
  try {
    await sb.from('shared_links').insert({
      title: `Info session: ${s.title}`, url: `${appUrl}/j/${s.id}/x`, link_type: 'info_session',
      description: `Session on ${when}. Your personal share link is on your My Links page.`,
      audience: 'marketers', posted_by: s.created_by, expires_at: s.scheduled_at,
    })
    const { data: marketers } = await sb.from('profiles').select('id, marketer_code').eq('is_active', true).neq('role', 'super_admin').limit(500)
    for (const m of marketers || []) {
      const personal = `${appUrl}/j/${s.id}/${m.marketer_code || 'x'}`
      try {
        await sb.from('notifications').insert({
          user_id: m.id, type: 'info_session',
          title: `New info session: ${s.title}`,
          body: `Share your personal link so joins count for you: ${personal}`,
          data: { link: personal },
        })
        marketersNotified++
      } catch {}
    }
  } catch {}

  /*
   * `sent` only when every lead was dealt with. Left `scheduled` while any
   * are pending so the runner picks the session up again — and because the
   * dedupe keys make that safe, the second run messages only the remainder.
   */
  const complete = pending === 0
  await sb.from('info_sessions').update({
    status: complete ? 'sent' : 'scheduled',
    sent_at: complete ? new Date().toISOString() : null,
    leads_notified: notified,
    marketers_notified: marketersNotified,
  }).eq('id', s.id)

  return {
    title: s.title,
    leads_notified: notified,
    marketers_notified: marketersNotified,
    /** Accepted by the queue and not yet confirmed. Not the same as sent. */
    queued,
    failed: failedSends,
    /** No usable number or address on the record. */
    unreachable,
    /** Left for the next run, because this one ran out of time. */
    pending,
    /** The first few numbers that need correcting, for the operator. */
    badNumbers,
    channels: usable,
  }
}

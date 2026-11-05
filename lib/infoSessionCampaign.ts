import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendEmail, emailConfigured } from '@/lib/integrations/email'
import { queueSMS } from '@/lib/notifications/sms'
import { normaliseRecipient } from '@/lib/integrations/sms'
import { whatsappConnected, smsConnected } from '@/lib/messaging'
import { tableExists, columnExists } from '@/lib/db/hasColumn'
import { resolveAudience } from '@/lib/leads/audienceQuery'
import { renderMessage, messageForSession } from '@/lib/leads/messageTemplate'
import type { AudienceFilter } from '@/lib/leads/audienceFilter'
import { lookup } from '@/lib/db/lookup'
import { publicOrigin } from '@/lib/url'
import { SECRETS } from '@/lib/config.server'

/**
 * SENDING A CAMPAIGN THAT FINISHES ON ITS OWN.
 *
 * ── WHAT THIS REPLACED ─────────────────────────────────────────────────────
 *
 * Every lead was messaged in a loop inside the request that pressed Send. A
 * serverless invocation does not live long enough for a few hundred of them,
 * so the loop stopped at a time budget and told the operator to press Send
 * again — five or six times for a list of eight hundred. The person had
 * become the scheduler.
 *
 * ── HOW IT FINISHES ITSELF ─────────────────────────────────────────────────
 *
 *   1. ENROL. The audience is written into info_session_recipients once, one
 *      row per lead, unique on (session, lead). That table is the campaign's
 *      memory: who is in it, who has been reached, who has not.
 *
 *   2. CLAIM. A worker takes a small batch with FOR UPDATE SKIP LOCKED, so
 *      two workers never take the same person and neither waits for the
 *      other. The claim stamps a time; a batch claimed by a worker that then
 *      died is reclaimed after five minutes.
 *
 *   3. CHAIN. When the batch is done and work remains, the worker starts the
 *      NEXT invocation over HTTP and returns. Each hop is a fresh serverless
 *      function with its own time budget, so the campaign is not racing one
 *      invocation's ceiling. No browser is involved: the first hop is fired
 *      by the Send request and the chain continues without it.
 *
 *   4. RECOVER. If a hop dies before it can start the next one, the periodic
 *      dispatcher finds the campaign still unfinished and resumes it. The
 *      chain is what makes it prompt; the cron is what makes it certain.
 *
 * Nothing here runs in memory between invocations, because nothing can.
 */

/** How many recipients one hop takes. Small enough that a hop always lands. */
export const BATCH_SIZE = 20

/**
 * When a hop stops claiming more work and hands over.
 *
 * Comfortably inside the 60-second ceiling the routes declare, because the
 * cost of overrunning is a killed invocation and a five-minute wait for the
 * stale-claim sweep, while the cost of stopping early is one extra hop.
 */
const HOP_BUDGET_MS = 35_000

/** A runaway chain is worse than a slow one. 40,000 recipients is the cap. */
const MAX_HOPS = 2_000

export type Progress = {
  total: number
  pending: number
  processing: number
  sent: number
  failed: number
  unreachable: number
  /** Nothing left to claim and nothing in flight. */
  complete: boolean
  /**
   * The recipients whose number could not be dialled, named.
   *
   * A count alone tells an operator that three numbers are wrong and not
   * which three, so the list stays wrong for ever. These come from the
   * ledger, so they survive the page being closed — unlike the toast that
   * used to carry them.
   */
  badNumbers: string[]
}

export type CampaignError = { error: string; retryable?: boolean }

const MISSING_TABLE: CampaignError = {
  error: 'This deployment has not run migration 0029 yet, so a campaign cannot keep track of who it has reached. '
    + 'Nothing was sent.',
}

/* ── 1. Enrol ─────────────────────────────────────────────────────────────── */

/**
 * Write the audience into the campaign, once.
 *
 * Idempotent by the unique key: running it again on a campaign already
 * enrolled inserts nothing and changes nobody's state. That is what makes it
 * safe for both the Send request and the recovery sweep to call.
 *
 * The audience comes from the criteria SAVED WITH THE CAMPAIGN, not from the
 * filters as they are now — a campaign created last week sent to the people
 * it selected last week, whatever anybody has edited since.
 */
export async function enrolRecipients(
  sessionId: string,
  audience: string,
  filter?: AudienceFilter | null,
): Promise<number | CampaignError> {
  if (!(await tableExists('info_session_recipients'))) return MISSING_TABLE

  const resolved = await resolveAudience(filter || legacyFilter(audience))
  if ('error' in resolved) return { error: resolved.error, retryable: true }

  const sb = createServiceClient()
  const hasMessageColumn = await columnExists('info_session_recipients', 'message')

  /*
   * The exact text each person is sent, stored with them.
   *
   * Rendered here rather than at sending time so the record is written once,
   * from the message the campaign was created with — and so a campaign
   * history can show what somebody actually received rather than the template
   * it came from.
   */
  const { row: session } = await lookup(
    sb.from('info_sessions').select('*').eq('id', sessionId).maybeSingle(),
  )

  for (let i = 0; i < resolved.sendable.length; i += 500) {
    const chunk = resolved.sendable.slice(i, i + 500).map(l => ({
      session_id: sessionId,
      lead_id: l.id,
      phone: l.phone,
      email: l.email,
      ...(hasMessageColumn && session
        ? { message: renderMessage(messageForSession(session).text, { session, lead: l, origin: publicOrigin() }) }
        : {}),
    }))
    const { error } = await sb.from('info_session_recipients')
      .upsert(chunk, { onConflict: 'session_id,lead_id', ignoreDuplicates: true })
    if (error) {
      console.error('[campaign] enrol failed:', error.message)
      return { error: 'The recipients could not be enrolled just now.', retryable: true }
    }
  }

  /*
   * Leads with no usable number are enrolled too, marked unreachable, so the
   * campaign can account for everybody it selected. Leaving them out would
   * make "212 selected, 209 recipients" a discrepancy nobody could explain.
   */
  for (let i = 0; i < resolved.excluded.length; i += 500) {
    const chunk = resolved.excluded.slice(i, i + 500).map(l => ({
      session_id: sessionId,
      lead_id: l.id,
      phone: l.phone,
      email: l.email,
      status: 'unreachable',
      last_error: l.reason,
    }))
    const { error } = await sb.from('info_session_recipients')
      .upsert(chunk, { onConflict: 'session_id,lead_id', ignoreDuplicates: true })
    if (error) console.error('[campaign] enrolling the unreachable failed:', error.message)
  }

  await honourEarlierSends(sessionId)
  return resolved.sendable.length
}

/**
 * Credit anybody this campaign has already reached, before it resumes.
 *
 * Campaigns sent before the ledger existed left their record in sms_logs and
 * nowhere else. Enrolling such a campaign marks every recipient `pending`,
 * including the ones already texted — and while the queue's dedupe key stops
 * a second TEXT, it says nothing about WhatsApp, which is tried first. Those
 * people would get the invitation a second time, by the other door.
 *
 * Only rows still `pending` are touched, so a result this campaign has since
 * recorded for itself is never overwritten by history.
 */
async function honourEarlierSends(sessionId: string): Promise<void> {
  const sb = createServiceClient()

  const { data: already, error } = await sb.from('sms_logs')
    .select('dedupe_key')
    .eq('kind', 'info_session')
    .eq('entity_id', sessionId)
    .eq('status', 'sent')
    .limit(5000)

  if (error) {
    // Not fatal: the worst case is the queue's dedupe key doing this job for
    // the SMS channel alone, which is where it was before.
    console.error('[campaign] could not read earlier sends:', error.message)
    return
  }

  /*
   * The lead id is the third part of the key this system wrote:
   * info_session:<session>:<lead>. Parsed rather than joined, because
   * sms_logs records a phone number and not a lead.
   */
  const leadIds = (already || [])
    .map(r => String(r.dedupe_key || '').split(':')[2])
    .filter(id => /^[0-9a-f-]{36}$/i.test(id))

  for (let i = 0; i < leadIds.length; i += 500) {
    const { error: markErr } = await sb.from('info_session_recipients')
      .update({ status: 'sent', channel: 'sms', sent_at: new Date().toISOString() })
      .eq('session_id', sessionId)
      .eq('status', 'pending')
      .in('lead_id', leadIds.slice(i, i + 500))
    if (markErr) console.error('[campaign] could not credit earlier sends:', markErr.message)
  }

  if (leadIds.length) {
    console.log(`[campaign] ${sessionId}: credited ${leadIds.length} recipient(s) reached before the ledger existed.`)
  }
}

/** The three presets this module shipped with, as filters. */
function legacyFilter(audience: string): AudienceFilter {
  if (audience === 'uncontacted') return { statuses: ['new'] }
  if (audience === 'interested') return { statuses: ['interested', 'follow_up'] }
  return {}
}

/* ── 2. Progress ──────────────────────────────────────────────────────────── */

export async function campaignProgress(sessionId: string): Promise<Progress | CampaignError> {
  if (!(await tableExists('info_session_recipients'))) return MISSING_TABLE

  const sb = createServiceClient()
  const { data, error } = await sb.rpc('info_session_progress', { p_session: sessionId })
  if (error) {
    console.error('[campaign] progress failed:', error.message)
    return { error: 'Progress could not be read just now.', retryable: true }
  }
  const row = (Array.isArray(data) ? data[0] : data) || {}
  const p: Progress = {
    total: Number(row.total || 0),
    pending: Number(row.pending || 0),
    processing: Number(row.processing || 0),
    sent: Number(row.sent || 0),
    failed: Number(row.failed || 0),
    unreachable: Number(row.unreachable || 0),
    complete: false,
    badNumbers: [],
  }
  p.complete = p.total > 0 && p.pending === 0 && p.processing === 0

  if (p.unreachable > 0) {
    // A handful, named, so they can be corrected. Not all of them: this is a
    // prompt to go and look, not a report.
    const { data: bad } = await sb.from('info_session_recipients')
      .select('phone, lead:lead_id(full_name)')
      .eq('session_id', sessionId).eq('status', 'unreachable').limit(10)
    p.badNumbers = (bad || []).map(r => {
      const lead = r.lead as unknown as { full_name?: string } | null
      return `${lead?.full_name || 'Unnamed'}: ${r.phone || 'no number'}`
    })
  }

  return p
}

/* ── 3. One batch ─────────────────────────────────────────────────────────── */

export type BatchResult = {
  claimed: number
  sent: number
  failed: number
  unreachable: number
  /** True when this hop believes there is more to do. */
  more: boolean
}

export async function processBatch(sessionId: string): Promise<BatchResult | CampaignError> {
  if (!(await tableExists('info_session_recipients'))) return MISSING_TABLE
  const sb = createServiceClient()

  const { row: s, failed } = await lookup(
    sb.from('info_sessions').select('*').eq('id', sessionId).maybeSingle(),
  )
  if (failed) return { error: 'The session could not be read.', retryable: true }
  if (!s) return { error: 'That session no longer exists.' }
  /*
   * Stopped or put away. Read before every batch, so cancelling a campaign
   * stops the NEXT one rather than pretending to recall what has gone — and
   * so a cancelled campaign is never restarted by the recovery sweep.
   */
  if (s.status === 'cancelled' || s.status === 'archived') {
    return { claimed: 0, sent: 0, failed: 0, unreachable: 0, more: false }
  }

  const wanted = String(s.channels || 'sms,whatsapp').split(',').map((c: string) => c.trim()).filter(Boolean)
  const usable = {
    sms: wanted.includes('sms') && smsConnected(),
    whatsapp: wanted.includes('whatsapp') && whatsappConnected(),
    email: wanted.includes('email') && emailConfigured(),
  }
  if (!usable.sms && !usable.whatsapp && !usable.email) {
    return {
      error: `None of the channels chosen (${wanted.join(', ') || 'none'}) can send from this deployment, `
        + 'so the campaign was stopped rather than marked sent.',
    }
  }

  const { data: claimed, error: claimErr } = await sb.rpc('claim_info_session_batch', {
    p_session: sessionId, p_limit: BATCH_SIZE,
  })
  if (claimErr) {
    console.error('[campaign] claim failed:', claimErr.message)
    return { error: 'This batch could not be claimed.', retryable: true }
  }

  const rows = (claimed as Array<{ id: string; lead_id: string; phone: string | null; email: string | null; message?: string | null }>) || []
  if (!rows.length) return { claimed: 0, sent: 0, failed: 0, unreachable: 0, more: false }

  const appUrl = publicOrigin()

  const { data: marketers } = await sb.from('profiles').select('id, marketer_code').not('marketer_code', 'is', null)
  const codeById: Record<string, string> = {}
  for (const m of marketers || []) codeById[m.id] = m.marketer_code as string

  const { data: leadRows } = await sb.from('leads')
    .select('id, full_name, assigned_to').in('id', rows.map(r => r.lead_id))
  const leadById = new Map((leadRows || []).map(l => [l.id, l]))

  const deadline = Date.now() + HOP_BUDGET_MS
  let sent = 0, failedCount = 0, unreachable = 0
  const released: string[] = []

  for (const r of rows) {
    /*
     * Out of time. The rest of this claim goes straight back to `pending`
     * rather than waiting five minutes for the stale sweep — the next hop is
     * already being started and may as well find them.
     */
    if (Date.now() > deadline) { released.push(r.id); continue }

    const lead = leadById.get(r.lead_id)
    const code = lead?.assigned_to ? (codeById[lead.assigned_to] || 'x') : 'x'
    const joinLink = `${appUrl}/j/${sessionId}/${code}?p=${encodeURIComponent(r.phone || '')}`

    /*
     * What this person is sent is what was written for them.
     *
     * Stored on their row at enrolment, so the campaign cannot drift from
     * what the author composed and the history can show the exact text. A row
     * from before that column existed falls back to rendering the session's
     * message now; a campaign with no message at all cannot be created, so an
     * empty one here is a fault worth refusing rather than papering over with
     * a sentence nobody wrote.
     */
    /*
     * What this person is sent is what was written for them, stored on their
     * row at enrolment. A row from before that column existed renders it now
     * — from the campaign's own message, or, for a campaign created before
     * authors could write one, from the text that WAS the message then.
     */
    const msg = (r.message || '').trim()
      || renderMessage(messageForSession(s).text, {
        session: s, lead: { ...lead, phone: r.phone }, origin: appUrl, marketerCode: code,
      })

    if (!msg) {
      failedCount++
      await mark(sb, r.id, 'failed', null, 'This campaign has no message, so nothing was sent.')
      continue
    }

    const dialable = normaliseRecipient(r.phone || '')
    if (!dialable && !(usable.email && r.email)) {
      unreachable++
      await mark(sb, r.id, 'unreachable', null, 'No usable phone number or email address.')
      continue
    }

    let channel: string | null = null
    let error: string | null = null

    if (usable.whatsapp && dialable) {
      try { if (await sendWhatsAppText(r.phone as string, msg, lead?.assigned_to || null)) channel = 'whatsapp' }
      catch (e) { error = e instanceof Error ? e.message : 'WhatsApp failed.' }
    }

    if (!channel && usable.sms && dialable) {
      try {
        const res = await queueSMS({
          to: r.phone as string, message: msg,
          kind: 'info_session', entityId: sessionId,
          // Belt and braces: the ledger already prevents a second attempt,
          // and this prevents a second TEXT even if it ever did.
          dedupeKey: `info_session:${sessionId}:${r.lead_id}`,
        })
        if (res.sent || res.duplicate) channel = 'sms'
        else if (res.queued) channel = 'sms_queued'
        else error = 'The number was refused by the sender.'
      } catch (e) { error = e instanceof Error ? e.message : 'The text could not be queued.' }
    }

    if (!channel && usable.email && r.email) {
      try {
        /*
         * The same words, laid out for a mailbox. The author's message is the
         * message — the email adds a button to the link it already contains
         * and nothing of its own.
         */
        const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#10231C">
          <p style="font-size:15px;line-height:1.7;white-space:pre-wrap">${escapeHtml(msg)}</p>
          <p style="margin:18px 0"><a href="${joinLink}" style="background:#0B3B2E;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600;font-size:14px">Join the session</a></p>
        </div>`
        if (await sendEmail(r.email, `${s.title} — Cambridge CE`, html, msg)) channel = 'email'
      } catch (e) { error = e instanceof Error ? e.message : 'The email could not be sent.' }
    }

    if (channel) { sent++; await mark(sb, r.id, 'sent', channel, null) }
    else { failedCount++; await mark(sb, r.id, 'failed', null, error || 'No channel accepted it.') }
  }

  if (released.length) {
    await sb.from('info_session_recipients')
      .update({ status: 'pending', claimed_at: null })
      .in('id', released)
  }

  return { claimed: rows.length, sent, failed: failedCount, unreachable, more: true }
}

/** The author's text goes into an HTML mail, so their punctuation cannot become markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

async function mark(
  sb: ReturnType<typeof createServiceClient>,
  id: string, status: string, channel: string | null, error: string | null,
) {
  await sb.from('info_session_recipients').update({
    status, channel, last_error: error,
    sent_at: status === 'sent' ? new Date().toISOString() : null,
  }).eq('id', id)
}

/* ── 4. The chain ─────────────────────────────────────────────────────────── */

/**
 * Start the next hop, without waiting for it.
 *
 * The request only has to REACH Vercel; a new invocation then runs on its
 * own. Waiting for its response would tie this invocation's lifetime to the
 * whole remaining campaign, which is the thing being avoided — so the wait is
 * abandoned after a moment and the failure to hear back is not a failure.
 */
export async function triggerNextHop(sessionId: string, hop: number): Promise<void> {
  if (hop >= MAX_HOPS) {
    console.error('[campaign] hop ceiling reached for', sessionId, '— leaving it to the dispatcher.')
    return
  }
  const url = `${publicOrigin()}/api/info-sessions/worker?session=${encodeURIComponent(sessionId)}&hop=${hop + 1}`
  try {
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SECRETS.cronSecret}` },
      signal: AbortSignal.timeout(1_500),
    })
  } catch {
    /*
     * Expected: the abort fires long before the next hop finishes. What
     * matters is that the request was made. If it never arrived at all, the
     * dispatcher picks the campaign up on its next pass.
     */
  }
}

/* ── 5. One hop, end to end ───────────────────────────────────────────────── */

export type HopResult = BatchResult & { progress: Progress; chained: boolean }

/**
 * Do one batch and arrange for the next, finishing the campaign when there is
 * nothing left. This is the only thing the worker endpoint calls.
 */
export async function advanceCampaign(sessionId: string, hop = 0): Promise<HopResult | CampaignError> {
  const batch = await processBatch(sessionId)
  if ('error' in batch) return batch

  const progress = await campaignProgress(sessionId)
  if ('error' in progress) return progress

  const sb = createServiceClient()

  if (progress.complete) {
    /*
     * Marked sent HERE and nowhere else, once the ledger says every recipient
     * has been dealt with. A status set optimistically by the first hop is
     * what let a half-finished campaign look finished.
     */
    await sb.from('info_sessions').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      leads_notified: progress.sent,
    }).eq('id', sessionId).eq('status', 'sending')
    return { ...batch, progress, chained: false }
  }

  // Keep the running total visible while it works.
  await sb.from('info_sessions').update({ leads_notified: progress.sent }).eq('id', sessionId)

  await triggerNextHop(sessionId, hop)
  return { ...batch, progress, chained: true }
}

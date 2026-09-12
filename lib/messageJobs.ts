import { createServiceClient } from '@/lib/supabase/server'

/**
 * Duplicate protection for outgoing messages.
 *
 * A prompt cannot stop a message being sent twice — only a database can. Each
 * intended message claims a unique key before anything is sent. If the claim
 * fails, another run already owns it and this one stops. That covers webhook
 * retries, repeated workflow runs, network retries and concurrent executions.
 */

/** Try to claim the right to send. Returns false if something already has it. */
export async function claimJob(opts: {
  dedupeKey: string
  leadId?: string | null
  phone?: string | null
  kind: string
  body?: string | null
  scheduledAt?: Date | null
  sourceEvent?: string | null
}): Promise<boolean> {
  const sb = createServiceClient()
  const { error } = await sb.from('message_jobs').insert({
    dedupe_key: opts.dedupeKey,
    lead_id: opts.leadId || null,
    phone: opts.phone || null,
    kind: opts.kind,
    body: opts.body || null,
    scheduled_at: (opts.scheduledAt || new Date()).toISOString(),
    source_event: opts.sourceEvent || null,
  })
  // A unique-key clash means someone else claimed it first. That is success:
  // the message will go out exactly once.
  return !error
}

/**
 * Give a claim back, so the work can be attempted again.
 *
 * ── WHY THIS IS NOT markSent(key, false) ───────────────────────────────────
 *
 * claimJob succeeds by inserting a row whose dedupe_key is unique. Once that
 * row exists NOTHING re-claims it — `status` is never consulted, so a job
 * marked 'failed' is just as permanently claimed as one marked 'sent'.
 *
 * That is correct for work that genuinely was attempted: a WhatsApp message
 * the provider rejected should not be retried in a loop. It is wrong for work
 * that never happened at all, which is what a failed read leaves behind — the
 * claim says the gallery was sent, and the lead is simply never sent it, for
 * good, with a row recording the opposite.
 *
 * So: markSent(key, false) for "we tried and it did not work", and this for
 * "we never got as far as trying".
 */
export async function releaseJob(dedupeKey: string) {
  const sb = createServiceClient()
  const { error } = await sb.from('message_jobs').delete().eq('dedupe_key', dedupeKey)
  if (error) console.error('[messageJobs] could not release', dedupeKey, '—', error.message)
}

export async function markSent(dedupeKey: string, ok = true) {
  const sb = createServiceClient()
  await sb.from('message_jobs').update({
    status: ok ? 'sent' : 'failed',
    sent_at: new Date().toISOString(),
  }).eq('dedupe_key', dedupeKey).then(() => {}, () => {})
}

/** Has this incoming provider event already been handled? */
export async function alreadyProcessed(eventId?: string | null): Promise<boolean> {
  if (!eventId) return false
  const sb = createServiceClient()
  const { error } = await sb.from('processed_events').insert({ event_id: eventId })
  if (!error) return false                     // first time we have seen it

  /*
   * ── A FAILED INSERT IS NOT THE SAME AS A DUPLICATE ──────────────────────
   *
   * This read `return !!error` — ANY error meant "already seen". A unique
   * violation does mean that, and it is the case this exists for. Everything
   * else does not: the table missing, a policy refusing the write, the
   * database briefly unreachable. Each of those made every incoming message
   * look like a retry, so the webhook returned early and the lead was never
   * answered — silently, with no reply and no log, for as long as the
   * condition lasted.
   *
   * Answering twice is a bad day. Never answering is a lost lead, and it
   * looks identical to the webhook not being called at all. So an
   * unrecognised failure processes the message and says so.
   */
  const duplicate = error.code === '23505'
    || /duplicate key|unique constraint/i.test(error.message || '')
  if (duplicate) return true

  console.error('[messageJobs] could not record event', eventId,
    '— processing it rather than dropping it:', error.message)
  return false
}

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
  return !!error      // insert failed → we have seen this event before
}

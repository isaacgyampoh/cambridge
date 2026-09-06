import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { arkeselProvider, normaliseRecipient } from '@/lib/integrations/sms'
import type { SmsProvider } from '@/lib/notifications/provider'
import { MAX_ATTEMPTS, planNextState } from '@/lib/notifications/retry'

/**
 * Reliable SMS delivery.
 *
 * The previous arrangement was a single synchronous fetch with a ten-second
 * timeout returning a boolean, and every caller wrapped it in
 * `try {} catch {}` and discarded the result. One transient provider failure
 * was a permanently lost message that nobody could see afterwards.
 *
 * The shape here is the one the brief asks for:
 *
 *   intent → persisted job → attempt → record → bounded retry → give up visibly
 *
 * Two properties matter most:
 *
 *   Idempotency comes from a UNIQUE INDEX on dedupe_key, not from a prior
 *   SELECT. Two webhook deliveries can both read "not sent" before either
 *   writes; only one can win a unique insert.
 *
 *   A failure here never propagates. Queueing is best-effort by design: a
 *   registration must not roll back because a text message could not be sent.
 */

export type QueueSMSOptions = {
  to: string
  message: string
  /** What this message is for — 'lead_assigned', 'registration_confirmed', … */
  kind: string
  /** The record it belongs to, so failures can be traced back. */
  entityId?: string | null
  /**
   * Idempotency key. Given one, this exact message is sent at most once ever,
   * however many times the surrounding workflow runs.
   */
  dedupeKey?: string | null
  /** Attempt delivery immediately as well as queueing. Default true. */
  immediate?: boolean
  /**
   * The provider to send through. Defaults to Arkesel.
   *
   * Injectable so the retry path can be exercised against a scripted fake —
   * timeouts, temporary failures and the accepted-but-timed-out case — without
   * provoking the real provider to test our own code.
   */
  provider?: SmsProvider
}

export type QueueResult = {
  queued: boolean
  /** True when an existing job already owned this dedupe key. */
  duplicate: boolean
  /** True when the immediate attempt delivered it. */
  sent: boolean
  id?: string
}

/**
 * Queue a message, and by default try to send it straight away.
 *
 * The immediate attempt keeps normal delivery instant; the queue row is what
 * makes a failure recoverable rather than lost.
 */
export async function queueSMS(opts: QueueSMSOptions): Promise<QueueResult> {
  const recipient = normaliseRecipient(opts.to)
  if (!recipient) return { queued: false, duplicate: false, sent: false }

  const sb = createServiceClient()

  const { data: row, error } = await sb.from('sms_logs').insert({
    recipient,
    message: opts.message,
    kind: opts.kind,
    entity_id: opts.entityId || null,
    dedupe_key: opts.dedupeKey || null,
    provider: 'arkesel',
    status: 'queued',
    attempts: 0,
    max_attempts: MAX_ATTEMPTS,
    next_retry_at: new Date().toISOString(),
  }).select('id').single()

  if (error) {
    // A unique-key clash means this message is already owned by another run.
    // That is the system working: it will be sent exactly once.
    if (/duplicate key|unique constraint/i.test(error.message)) {
      return { queued: false, duplicate: true, sent: false }
    }
    console.error('[sms] could not queue', opts.kind, error.message)
    return { queued: false, duplicate: false, sent: false }
  }

  if (opts.immediate === false) {
    return { queued: true, duplicate: false, sent: false, id: row.id }
  }

  const sent = await attemptDelivery(
    row.id, recipient, opts.message, 1, MAX_ATTEMPTS, opts.provider ?? arkeselProvider
  )
  return { queued: true, duplicate: false, sent, id: row.id }
}

/**
 * Send one queued message and record the outcome.
 * Returns whether it was delivered. Never throws.
 *
 * The decision of what the outcome MEANS lives in lib/notifications/retry.ts
 * and is under test; this function's only job is to make the attempt and
 * persist that decision.
 */
async function attemptDelivery(
  id: string,
  recipient: string,
  message: string,
  attempt: number,
  maxAttempts = MAX_ATTEMPTS,
  provider: SmsProvider = arkeselProvider
): Promise<boolean> {
  const sb = createServiceClient()
  const result = await provider.send(recipient, message)
  const { reason, ...columns } = planNextState(result, attempt, maxAttempts)

  await sb.from('sms_logs').update({
    ...columns,
    // Keep whatever the provider said, for the delivery record. Never carries
    // our API key: it is the response body, not the request.
    provider_response: result.response ?? null,
  }).eq('id', id).then(() => {}, () => {})

  if (reason === 'permanent' || reason === 'exhausted') {
    console.error(
      `[sms] giving up on ${id} after ${attempt} attempt(s) (${reason}):`,
      recipient, result.error
    )
  }
  return columns.status === 'sent'
}

/**
 * Retry everything that is due. Called by the cron runner.
 *
 * Rows are claimed with SKIP LOCKED, so two overlapping cron runs take
 * disjoint batches rather than both sending the same message.
 */
export async function processSmsQueue(
  limit = 25,
  provider: SmsProvider = arkeselProvider
): Promise<{ claimed: number; sent: number; failed: number }> {
  const sb = createServiceClient()
  const { data: due, error } = await sb.rpc('claim_due_sms', { p_limit: limit })

  if (error) {
    console.error('[sms] could not claim queue:', error.message)
    return { claimed: 0, sent: 0, failed: 0 }
  }

  type Row = { id: string; recipient: string; message: string; attempts: number; max_attempts: number }
  const rows = (due || []) as Row[]

  let sent = 0, failed = 0
  for (const row of rows) {
    const ok = await attemptDelivery(
      row.id, row.recipient, row.message, row.attempts, row.max_attempts, provider
    )
    if (ok) sent++; else failed++
  }

  return { claimed: rows.length, sent, failed }
}

/** A snapshot of delivery health, for the observability screen. */
export async function smsHealth(): Promise<{
  queued: number; retrying: number; failed24h: number; sent24h: number
}> {
  const sb = createServiceClient()
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()

  const [queued, retrying, failed24h, sent24h] = await Promise.all([
    sb.from('sms_logs').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    sb.from('sms_logs').select('id', { count: 'exact', head: true }).eq('status', 'retrying'),
    sb.from('sms_logs').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', dayAgo),
    sb.from('sms_logs').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('created_at', dayAgo),
  ])

  return {
    queued: queued.count || 0,
    retrying: retrying.count || 0,
    failed24h: failed24h.count || 0,
    sent24h: sent24h.count || 0,
  }
}

/**
 * The delivery state machine, separated from the database.
 *
 * ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────
 *
 * The retry path was written and deployed but never observed working. The
 * twenty-two timeout failures that prompted it were historical, and the only
 * way to watch a retry actually fire was to wait for Arkesel to be slow again.
 *
 * The decision — send again, or give up — was buried inside a function that
 * also opened a Supabase client and issued an UPDATE, so it could not be
 * exercised without a database and a provider. Pulling the decision out means
 * the rules that determine whether a member of staff ever receives their
 * message are under test, and the queue writes what this returns rather than
 * deciding again for itself.
 *
 * No imports. Nothing here touches the network, the clock, or the database:
 * `now` is a parameter precisely so a test can assert exact backoff instants.
 */

import type { SendOutcome } from './provider.ts'

/**
 * The statuses a row moves through.
 *
 *   queued    accepted from the caller, not yet attempted
 *   sending   claimed by a worker, attempt in flight
 *   retrying  attempt failed, another is due at next_retry_at
 *   sent      the provider accepted it
 *   failed    given up: attempts exhausted, or a failure retrying cannot fix
 */
export type SmsStatus = 'queued' | 'sending' | 'retrying' | 'sent' | 'failed'

export const MAX_ATTEMPTS = 4

/**
 * Backoff before attempt N+1, in minutes: 1, 5, 25, capped at 120.
 *
 * Long enough that a provider outage is given time to end rather than being
 * hammered, short enough that a staff member is not told about their lead an
 * hour late.
 */
export function backoffMinutes(attempt: number): number {
  return Math.min(5 ** Math.max(0, attempt - 1), 120)
}

/** Exactly the columns the queue writes after an attempt. */
export type StateChange = {
  status: SmsStatus
  attempts: number
  sent_at: string | null
  next_retry_at: string | null
  provider_message_id: string | null
  last_error: string | null
  /** Not a column — why the row landed here, for logs and for the test. */
  reason: 'delivered' | 'permanent' | 'exhausted' | 'will_retry'
}

/**
 * Decide what one attempt's outcome means for the row.
 *
 * `attempt` is the number of the attempt just made, 1-based. claim_due_sms
 * increments `attempts` as it claims, so the value carried on a claimed row is
 * already the attempt being made — not the one before it.
 */
export function planNextState(
  outcome: SendOutcome,
  attempt: number,
  maxAttempts: number = MAX_ATTEMPTS,
  now: Date = new Date()
): StateChange {
  if (outcome.ok) {
    return {
      status: 'sent',
      attempts: attempt,
      sent_at: now.toISOString(),
      next_retry_at: null,
      // Persisted on the way through, so a delivery query can later be taken
      // to the provider with a reference rather than a description.
      provider_message_id: outcome.providerMessageId ?? null,
      last_error: null,
      reason: 'delivered',
    }
  }

  // A permanent failure is not retried at all. Four attempts at a malformed
  // number is four guaranteed rejections, and it delays every real message
  // behind it in the batch.
  const permanent = outcome.permanent === true
  const exhausted = attempt >= maxAttempts

  return {
    status: permanent || exhausted ? 'failed' : 'retrying',
    attempts: attempt,
    sent_at: null,
    next_retry_at: permanent || exhausted
      ? null
      : new Date(now.getTime() + backoffMinutes(attempt) * 60_000).toISOString(),
    provider_message_id: null,
    // Truncated, not dropped. "failed" with no reason is a number nobody can
    // act on, which is the state the system was in before.
    last_error: outcome.error?.slice(0, 500) || 'Delivery failed',
    reason: permanent ? 'permanent' : exhausted ? 'exhausted' : 'will_retry',
  }
}

/**
 * ── HOW DUPLICATE PREVENTION ACTUALLY WORKS ────────────────────────────────
 *
 * Three separate duplicate risks, two of which are closed and one of which is
 * a deliberate, bounded choice. Stating which is which matters more than
 * claiming the problem is solved.
 *
 * 1. THE SAME WORKFLOW RUNS TWICE.
 *    A retried webhook, a double-clicked button, a re-run import. Closed by a
 *    UNIQUE INDEX on sms_logs(dedupe_key) — migration 0003. A prior SELECT
 *    could not close it: two callers can both read "not sent" before either
 *    writes. The insert is the check.
 *
 * 2. TWO WORKERS CLAIM THE SAME ROW.
 *    Whenever a cron run takes longer than its interval, runs overlap. Closed
 *    by claim_due_sms: FOR UPDATE SKIP LOCKED plus a status flip to 'sending'
 *    inside the claiming statement, so the second worker cannot see the row as
 *    claimable. Rows left in 'sending' by a killed worker are reclaimed after
 *    a grace period — migration 0012 — rather than being stranded.
 *
 * 3. OUR REQUEST TIMED OUT BUT THE PROVIDER ACCEPTED IT.
 *    NOT closed, and it cannot be closed from this side: Arkesel's v2 send
 *    endpoint takes no idempotency key, and after a timeout we hold no message
 *    id to query a status against. Anything claiming otherwise would be
 *    guessing.
 *
 *    The choice made is at-least-once, deliberately. In this system a missed
 *    message is a lead nobody follows up or an admission nobody is told about;
 *    a duplicate is one repeated text. Twenty-two staff missed notifications
 *    to exactly this failure mode. So a timeout is retried — and the exposure
 *    is bounded rather than open-ended:
 *
 *      · at most `maxAttempts` sends (4) for any one message, ever;
 *      · every attempt is recorded with its own error, so a duplicate can be
 *        explained afterwards instead of being a mystery;
 *      · where a response WAS received, provider_message_id is stored, which
 *        is the evidence that distinguishes "the provider never got it" from
 *        "the provider got it and we stopped listening".
 *
 * The test for this is tests/smsRetry.test.ts, which asserts the bound holds
 * against a provider scripted to accept every request and time out on all of
 * them.
 */

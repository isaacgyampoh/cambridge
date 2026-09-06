import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  FakeSmsProvider, isPermanentFailure, classifyFailure, extractMessageId,
} from '../lib/notifications/provider.ts'
import { planNextState, backoffMinutes, MAX_ATTEMPTS, type SmsStatus } from '../lib/notifications/retry.ts'

/**
 * SMS retry regression tests.
 *
 * ── WHAT PROMPTED THESE ────────────────────────────────────────────────────
 *
 * The reported symptom was "some staff get notification via SMS, some do not".
 * The cause found in production: 438 sent against 27 failed, and 22 of those
 * 27 were staff, every one of them carrying the identical error
 * "The operation was aborted due to timeout". The sender had a ten-second
 * timeout and no retry at all, so a provider having a slow minute was a
 * permanently lost message that nobody could see afterwards.
 *
 * A retry path was added. It was never observed working — the failures were
 * historical, and the only way to watch one fire was to wait for Arkesel to be
 * slow again. Deliberately provoking the live provider to test our own code is
 * not acceptable, so the provider is a parameter and a scripted fake stands in.
 *
 * ── WHAT IS AND IS NOT REAL HERE ───────────────────────────────────────────
 *
 * planNextState, backoffMinutes and FakeSmsProvider are the production
 * modules, imported directly. The store and claim loop below are a MIRROR of
 * claim_due_sms (migration 0003), not the function itself: running the real
 * one needs Postgres. Where the mirror could drift from the SQL it is called
 * out in a comment. Read these as proving the decision logic, not the SQL.
 */

/* ─────────────────────────────────────────────
   An in-memory sms_logs, faithful to the constraints that matter
   ───────────────────────────────────────────── */

/** Matches the INTERVAL '15 minutes' lease in migration 0012. */
const LEASE_MINUTES = 15

type Row = {
  id: string
  recipient: string
  message: string
  kind: string
  dedupe_key: string | null
  status: SmsStatus
  attempts: number
  max_attempts: number
  next_retry_at: string | null
  sent_at: string | null
  provider_message_id: string | null
  last_error: string | null
}

class FakeQueue {
  readonly rows: Row[] = []
  /** Every status a row has held, in order — the lifecycle assertion target. */
  readonly history = new Map<string, SmsStatus[]>()
  private seq = 0

  /** now(), as a mutable clock, so backoff can be crossed without waiting. */
  clock = new Date('2026-09-06T09:00:00.000Z')

  private track(row: Row) {
    const seen = this.history.get(row.id) ?? []
    if (seen[seen.length - 1] !== row.status) seen.push(row.status)
    this.history.set(row.id, seen)
  }

  /**
   * Mirrors the INSERT in queueSMS, including the UNIQUE INDEX on dedupe_key.
   * Returns null when the key is already taken — which is the whole mechanism:
   * two callers can both read "not sent" before either writes, so the insert
   * has to be the check.
   */
  enqueue(opts: { recipient: string; message: string; kind: string; dedupeKey?: string | null }): Row | null {
    const key = opts.dedupeKey ?? null
    if (key !== null && this.rows.some(r => r.dedupe_key === key)) return null

    const row: Row = {
      id: `row-${++this.seq}`,
      recipient: opts.recipient,
      message: opts.message,
      kind: opts.kind,
      dedupe_key: key,
      status: 'queued',
      attempts: 0,
      max_attempts: MAX_ATTEMPTS,
      next_retry_at: this.clock.toISOString(),
      sent_at: null,
      provider_message_id: null,
      last_error: null,
    }
    this.rows.push(row)
    this.track(row)
    return row
  }

  /**
   * Mirrors claim_due_sms: same predicate, same status flip, same increment,
   * same fifteen-minute lease.
   *
   * The flip to 'sending' inside the claim is what stops a second worker
   * seeing the row as claimable. In Postgres that is enforced by FOR UPDATE
   * SKIP LOCKED within a single statement; here it is a synchronous loop,
   * which cannot reproduce the locking — only the visibility rule that
   * follows from it.
   */
  claimDue(limit = 25): Row[] {
    const now = this.clock.getTime()
    const due = this.rows.filter(r => {
      if (r.attempts >= r.max_attempts) return false
      const dueAt = r.next_retry_at === null ? -Infinity : Date.parse(r.next_retry_at)
      if (r.status === 'queued' || r.status === 'retrying') return dueAt <= now
      // A row still held by a live worker is not claimable until its lease
      // lapses; one whose worker died is.
      if (r.status === 'sending') return r.next_retry_at !== null && dueAt <= now
      return false
    }).slice(0, limit)

    for (const r of due) {
      r.status = 'sending'
      r.attempts += 1
      r.next_retry_at = new Date(now + LEASE_MINUTES * 60_000).toISOString()
      this.track(r)
    }
    return due
  }

  /** Mirrors attemptDelivery: real provider call, real planNextState, write. */
  async attempt(row: Row, provider: FakeSmsProvider): Promise<boolean> {
    const outcome = await provider.send(row.recipient, row.message)
    const plan = planNextState(outcome, row.attempts, row.max_attempts, this.clock)
    // Exactly the columns attemptDelivery writes; `reason` is for logging.
    Object.assign(row, {
      status: plan.status,
      attempts: plan.attempts,
      sent_at: plan.sent_at,
      next_retry_at: plan.next_retry_at,
      provider_message_id: plan.provider_message_id,
      last_error: plan.last_error,
    })
    this.track(row)
    return row.status === 'sent'
  }

  /** Mirrors processSmsQueue for one cron tick. */
  async drain(provider: FakeSmsProvider, limit = 25) {
    let sent = 0, failed = 0
    const claimed = this.claimDue(limit)
    for (const row of claimed) {
      if (await this.attempt(row, provider)) sent++
      else failed++
    }
    return { claimed: claimed.length, sent, failed }
  }

  /** Advance past the scheduled backoff so the next tick sees the row. */
  advanceMinutes(m: number) {
    this.clock = new Date(this.clock.getTime() + m * 60_000)
  }

  /** Run ticks until nothing is left due, jumping the clock between them. */
  async runToCompletion(provider: FakeSmsProvider, maxTicks = 12) {
    for (let i = 0; i < maxTicks; i++) {
      const { claimed } = await this.drain(provider)
      if (claimed === 0) return
      this.advanceMinutes(180)   // past the 120-minute backoff cap
    }
  }

  statusOf(id: string): SmsStatus[] { return this.history.get(id) ?? [] }
}

/* ─────────────────────────────────────────────
   The lifecycle the brief asks for
   ───────────────────────────────────────────── */

describe('the delivery lifecycle', () => {
  test('the happy path: queued → sending → sent, in one attempt', async () => {
    const q = new FakeQueue()
    const provider = new FakeSmsProvider({ script: ['success'] })
    const row = q.enqueue({ recipient: '233201234567', message: 'Lead assigned', kind: 'lead_assigned' })!

    await q.drain(provider)

    assert.deepEqual(q.statusOf(row.id), ['queued', 'sending', 'sent'])
    assert.equal(row.attempts, 1)
    assert.equal(provider.calls.length, 1)
    assert.equal(row.next_retry_at, null, 'a sent message must leave the retry scan')
    assert.ok(row.sent_at)
  })

  test('PENDING → SENDING → TIMEOUT → RETRYING → SENT', async () => {
    // The exact sequence from the brief. Before the retry path existed, this
    // stopped at the timeout and the staff member was never told.
    const q = new FakeQueue()
    const provider = new FakeSmsProvider({ script: ['timeout', 'success'] })
    const row = q.enqueue({ recipient: '233201234567', message: 'Lead assigned', kind: 'lead_assigned' })!

    await q.drain(provider)
    assert.equal(row.status, 'retrying', 'a timeout must schedule another attempt, not give up')
    assert.match(row.last_error!, /aborted due to timeout/)
    assert.ok(row.next_retry_at, 'a retrying row must carry the instant it is next due')

    // Nothing happens until the backoff has actually elapsed.
    const early = await q.drain(provider)
    assert.equal(early.claimed, 0, 'the row must not be reclaimed before its backoff expires')
    assert.equal(provider.calls.length, 1)

    q.advanceMinutes(2)
    await q.drain(provider)

    assert.deepEqual(q.statusOf(row.id), ['queued', 'sending', 'retrying', 'sending', 'sent'])
    assert.equal(row.attempts, 2)
    assert.equal(provider.calls.length, 2)
    assert.equal(row.provider_message_id, 'fake-2')
  })

  test('a temporary failure is retried; the message still arrives', async () => {
    const q = new FakeQueue()
    const provider = new FakeSmsProvider({ script: ['temporary', 'temporary', 'success'] })
    const row = q.enqueue({ recipient: '233201234567', message: 'Ready to join', kind: 'ready_to_join' })!

    await q.runToCompletion(provider)

    assert.equal(row.status, 'sent')
    assert.equal(row.attempts, 3)
    assert.equal(row.last_error, null, 'a delivered message must not keep a stale error')
    assert.equal(provider.acceptedCount('233201234567', 'Ready to join'), 1)
  })

  test('a permanent failure is not retried at all', async () => {
    // Four attempts at a number the provider will refuse identically is four
    // guaranteed rejections, and it delays every real message behind it.
    const q = new FakeQueue()
    const provider = new FakeSmsProvider({ fallback: 'permanent' })
    const row = q.enqueue({ recipient: '233201234567', message: 'x', kind: 'test' })!

    await q.runToCompletion(provider)

    assert.deepEqual(q.statusOf(row.id), ['queued', 'sending', 'failed'])
    assert.equal(row.attempts, 1, 'a permanent rejection must cost exactly one attempt')
    assert.equal(provider.calls.length, 1)
    assert.equal(row.next_retry_at, null)
    assert.match(row.last_error!, /No valid number/)
  })

  test('a slow provider still counts as delivered', async () => {
    const q = new FakeQueue()
    const provider = new FakeSmsProvider({ script: ['slow'] })
    const row = q.enqueue({ recipient: '233201234567', message: 'x', kind: 'test' })!

    const started = Date.now()
    await q.drain(provider)

    assert.equal(row.status, 'sent')
    assert.ok(Date.now() - started >= 45, 'the slow behaviour must actually have delayed')
  })

  test('a message that never gets through fails visibly rather than vanishing', async () => {
    const q = new FakeQueue()
    const provider = new FakeSmsProvider({ fallback: 'timeout' })
    const row = q.enqueue({ recipient: '233201234567', message: 'x', kind: 'test' })!

    await q.runToCompletion(provider)

    assert.equal(row.status, 'failed')
    assert.equal(row.attempts, MAX_ATTEMPTS)
    assert.equal(provider.calls.length, MAX_ATTEMPTS, 'the attempt ceiling must be hard')
    assert.ok(row.last_error, 'giving up without a recorded reason is what the old system did')
    assert.equal(row.next_retry_at, null, 'a dead row must leave the retry scan')
  })
})

/* ─────────────────────────────────────────────
   Backoff
   ───────────────────────────────────────────── */

describe('backoff', () => {
  test('the schedule is 1, 5, 25 minutes, capped at two hours', () => {
    assert.equal(backoffMinutes(1), 1)
    assert.equal(backoffMinutes(2), 5)
    assert.equal(backoffMinutes(3), 25)
    assert.equal(backoffMinutes(4), 120)
    assert.equal(backoffMinutes(9), 120)
  })

  test('next_retry_at is the failure instant plus the backoff, exactly', () => {
    const now = new Date('2026-09-06T09:00:00.000Z')
    const state = planNextState({ ok: false, permanent: false, error: 'timeout' }, 2, 4, now)
    assert.equal(state.next_retry_at, '2026-09-06T09:05:00.000Z')
  })
})

/* ─────────────────────────────────────────────
   Duplicate prevention — what holds, and what does not
   ───────────────────────────────────────────── */

describe('duplicate prevention', () => {
  test('the same workflow running twice sends one message, not two', async () => {
    // A retried webhook, a double-clicked button, a re-run import.
    const q = new FakeQueue()
    const provider = new FakeSmsProvider({ fallback: 'success' })
    const key = 'registration_confirmed:app-123'

    const first = q.enqueue({ recipient: '233201234567', message: 'Confirmed', kind: 'reg', dedupeKey: key })
    const second = q.enqueue({ recipient: '233201234567', message: 'Confirmed', kind: 'reg', dedupeKey: key })

    assert.ok(first)
    assert.equal(second, null, 'the unique index on dedupe_key must reject the second insert')

    await q.runToCompletion(provider)
    assert.equal(provider.acceptedCount('233201234567', 'Confirmed'), 1)
  })

  test('two overlapping workers never claim the same row', async () => {
    // Cron runs overlap whenever one takes longer than its interval.
    const q = new FakeQueue()
    for (let i = 0; i < 5; i++) {
      q.enqueue({ recipient: `23320123456${i}`, message: 'x', kind: 'test' })
    }

    const workerA = q.claimDue()
    const workerB = q.claimDue()

    assert.equal(workerA.length, 5)
    assert.equal(workerB.length, 0, 'claiming must flip the row out of the claimable set')
    const ids = new Set([...workerA, ...workerB].map(r => r.id))
    assert.equal(ids.size, 5)
  })

  test('a timeout the provider actually accepted DOES resend — bounded, not prevented', async () => {
    /*
     * This is the case the brief asks about, and the honest answer is that it
     * is not prevented. Our request timed out; the provider took the message
     * anyway. Arkesel's v2 send endpoint accepts no idempotency key, and after
     * a timeout we hold no message id to query a status against, so there is
     * nothing on this side that can tell the two situations apart.
     *
     * The choice is at-least-once, deliberately: in this system a missed
     * message is a lead nobody follows up, and twenty-two staff missed theirs
     * to exactly this failure mode. What is guaranteed instead is a BOUND.
     */
    const q = new FakeQueue()
    const provider = new FakeSmsProvider({ fallback: 'timeout_but_accepted' })
    const row = q.enqueue({ recipient: '233201234567', message: 'Lead assigned', kind: 'lead_assigned' })!

    await q.runToCompletion(provider)

    assert.equal(row.status, 'failed', 'we never saw a success, so the row must end visibly failed')
    assert.equal(
      provider.acceptedCount('233201234567', 'Lead assigned'), MAX_ATTEMPTS,
      'the duplicate exposure is exactly the attempt ceiling — never unbounded'
    )
    assert.ok(row.last_error, 'and every duplicate is explainable from the record')
  })

  test('one timeout-then-success costs one duplicate, and the record shows why', async () => {
    const q = new FakeQueue()
    const provider = new FakeSmsProvider({ script: ['timeout_but_accepted', 'success'] })
    const row = q.enqueue({ recipient: '233201234567', message: 'Confirmed', kind: 'reg' })!

    await q.runToCompletion(provider)

    assert.equal(row.status, 'sent')
    assert.equal(provider.acceptedCount('233201234567', 'Confirmed'), 2)
    // The second attempt is the one we have evidence for; the first is the one
    // we stopped listening to. That asymmetry is the whole diagnostic value.
    assert.equal(row.provider_message_id, 'fake-2')
  })
})

/* ─────────────────────────────────────────────
   Classifying what the real provider says
   ───────────────────────────────────────────── */

describe('classifying a provider response', () => {
  test('4xx is permanent, but 429 is the provider asking us to slow down', () => {
    assert.equal(isPermanentFailure(400), true)
    assert.equal(isPermanentFailure(401), true)
    assert.equal(isPermanentFailure(422), true)
    assert.equal(isPermanentFailure(429), false, 'rate limiting must be retried, not abandoned')
    assert.equal(isPermanentFailure(500), false)
    assert.equal(isPermanentFailure(502), false)
    assert.equal(isPermanentFailure(503), false)
  })

  test('the message id is found in every shape Arkesel has used', () => {
    assert.equal(extractMessageId({ message_id: 'a1' }), 'a1')
    assert.equal(extractMessageId({ messageId: 'b2' }), 'b2')
    assert.equal(extractMessageId({ id: 'c3' }), 'c3')
    assert.equal(extractMessageId({ data: { message_id: 'd4' } }), 'd4')
    assert.equal(extractMessageId({ data: [{ id: 'e5' }] }), 'e5')
  })

  test('an unrecognised body records nothing rather than inventing a reference', () => {
    assert.equal(extractMessageId({ status: 'success' }), null)
    assert.equal(extractMessageId(null), null)
    assert.equal(extractMessageId('ok'), null)
    assert.equal(extractMessageId({ id: 42 }), null, 'a numeric id is not a reference we can quote')
  })

  test('a delivered message carries the reference into the record', () => {
    const state = planNextState(
      { ok: true, permanent: false, providerMessageId: 'ark-99' }, 1, 4, new Date()
    )
    assert.equal(state.status, 'sent')
    assert.equal(state.provider_message_id, 'ark-99')
  })
})

/* ─────────────────────────────────────────────
   The claim lease — a worker that dies must not lose the message
   ───────────────────────────────────────────── */

describe('a worker that dies mid-attempt', () => {
  test('its row is reclaimed once the lease lapses, and still delivered', async () => {
    /*
     * claim_due_sms flips a row to 'sending' as it claims it. Before the lease
     * existed, 'sending' was in no reclaim predicate at all: a function killed
     * between the claim and the update — the exact way the lead import used to
     * die — left the row there permanently. It was never retried and never
     * appeared in the failed list. It was simply lost, silently.
     */
    const q = new FakeQueue()
    const provider = new FakeSmsProvider({ fallback: 'success' })
    const row = q.enqueue({ recipient: '233201234567', message: 'Lead assigned', kind: 'lead_assigned' })!

    // Claim it, then never attempt it: the worker was killed.
    q.claimDue()
    assert.equal(row.status, 'sending')
    assert.equal(provider.calls.length, 0)

    // A healthy worker arriving immediately must NOT steal it.
    assert.equal(q.claimDue().length, 0, 'a live lease must be respected')

    q.advanceMinutes(LEASE_MINUTES + 1)
    await q.drain(provider)

    assert.equal(row.status, 'sent', 'the stranded message must eventually be delivered')
    assert.equal(provider.calls.length, 1)
  })

  test('an old message claimed a second ago is not treated as abandoned', () => {
    // The trap in the obvious implementation: keying the sweep on created_at
    // rather than on a fresh lease. A message queued hours ago and claimed one
    // second ago would be handed straight to a second worker — manufacturing
    // the duplicate the claim exists to prevent.
    const q = new FakeQueue()
    const row = q.enqueue({ recipient: '233201234567', message: 'x', kind: 'test' })!
    q.advanceMinutes(240)              // the row is now four hours old
    q.claimDue()
    assert.equal(row.status, 'sending')
    assert.equal(q.claimDue().length, 0, 'age is not evidence of abandonment')
  })

  test('the lease never survives a completed attempt', async () => {
    const q = new FakeQueue()
    const provider = new FakeSmsProvider({ script: ['timeout'] })
    const row = q.enqueue({ recipient: '233201234567', message: 'x', kind: 'test' })!

    await q.drain(provider)

    // The real backoff replaced the lease, rather than the row waiting 15
    // minutes for a lease that no longer means anything.
    assert.equal(row.status, 'retrying')
    assert.equal(row.next_retry_at, '2026-09-06T09:01:00.000Z')
  })
})

/* ─────────────────────────────────────────────
   Arkesel refuses some requests in the body, not the status code
   ───────────────────────────────────────────── */

describe('body-level rejections', () => {
  test('"No valid number in recipients!" is permanent whatever the status code', () => {
    /*
     * Not hypothetical: five of the twenty-seven real failures in this
     * database are exactly this body. Classifying on the HTTP status alone,
     * a 200 carrying it would be retried four times — four guaranteed
     * rejections, delaying every real message behind them.
     */
    const body = { status: 'error', message: 'No valid number in recipients!' }
    assert.equal(classifyFailure(200, body), true)
    assert.equal(classifyFailure(400, body), true)
  })

  test('a condition that will pass on its own is still retried', () => {
    assert.equal(classifyFailure(200, { status: 'error', message: 'Insufficient balance' }), false)
    assert.equal(classifyFailure(200, { status: 'error', message: 'Rate limit exceeded' }), false)
    assert.equal(classifyFailure(200, { status: 'error', message: 'Service temporarily down' }), false)
  })

  test('with no usable body it falls back to the transport status', () => {
    assert.equal(classifyFailure(400, {}), true)
    assert.equal(classifyFailure(503, {}), false)
    assert.equal(classifyFailure(429, {}), false)
    assert.equal(classifyFailure(500, null), false)
  })

  test('the real success body yields the reference', () => {
    // Copied verbatim from a delivered row in production.
    const body = {
      data: [{ id: '01770509-4c83-4023-a6b7-ba365e840ad9', recipient: '233266381203' }],
      status: 'success', sms_balance: 0, main_balance: 591.127,
    }
    assert.equal(extractMessageId(body), '01770509-4c83-4023-a6b7-ba365e840ad9')
  })
})

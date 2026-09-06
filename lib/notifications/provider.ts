/**
 * The SMS provider, behind an interface.
 *
 * Pure and dependency-free so it can be unit tested directly: no server-only
 * import, no database, no network unless the real provider is used.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The retry path was deployed but unproven: the twenty-two timeout failures
 * found in production were historical, and the only way to watch a retry fire
 * was to wait for Arkesel to be slow again. Deliberately provoking a real
 * provider to test our own code is not acceptable, so the provider becomes a
 * parameter and a fake takes its place in tests.
 *
 * The fake can produce every outcome that matters: success, timeout, temporary
 * failure, permanent failure, a slow response, and the case that actually
 * costs money — a request that TIMED OUT for us but was accepted upstream.
 */

export type SendOutcome = {
  ok: boolean
  /**
   * True when retrying cannot help: a malformed number, a rejected key, a
   * message the provider will refuse identically every time. This is the
   * difference between burning four attempts on a dead number and recovering
   * from a provider having a bad minute.
   */
  permanent: boolean
  /**
   * The provider's own identifier for the message.
   *
   * Persisted so that "why didn't this person get their SMS?" can be taken to
   * Arkesel with a reference rather than a description. It is also the only
   * thing that can later prove a timed-out request was in fact delivered.
   */
  providerMessageId?: string | null
  error?: string
  /** Raw provider payload, for the delivery log. Never contains our API key. */
  response?: unknown
}

export interface SmsProvider {
  readonly name: string
  send(to: string, message: string): Promise<SendOutcome>
}

/* ─────────────────────────────────────────────
   The deterministic fake
   ───────────────────────────────────────────── */

export type FakeBehaviour =
  | 'success'
  /** We give up waiting. The provider may or may not have accepted it. */
  | 'timeout'
  /** A 5xx or 429 — worth trying again shortly. */
  | 'temporary'
  /** A 4xx — the same request will be refused identically forever. */
  | 'permanent'
  /** Succeeds, but only after the given delay. */
  | 'slow'
  /**
   * The expensive case: our request times out, but the provider DID accept the
   * message. A naive retry sends the same text to the same person twice.
   */
  | 'timeout_but_accepted'

export type FakeCall = { to: string; message: string; at: number }

/**
 * A provider whose behaviour is scripted.
 *
 * `script` is consumed one entry per call; once exhausted, `fallback` is used
 * for every subsequent call. That is what lets a test say "fail twice, then
 * succeed" and assert the whole retry sequence.
 */
export class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake'

  /** Every call made, in order — the record a test asserts against. */
  readonly calls: FakeCall[] = []

  /**
   * Messages the provider considers itself to have ACCEPTED, keyed by
   * recipient and text. Includes the timeout_but_accepted case, which is
   * exactly the situation a duplicate would arise from.
   */
  readonly accepted: Array<{ to: string; message: string; id: string }> = []

  private script: FakeBehaviour[]
  private fallback: FakeBehaviour
  private counter = 0

  constructor(opts: { script?: FakeBehaviour[]; fallback?: FakeBehaviour } = {}) {
    this.script = [...(opts.script ?? [])]
    this.fallback = opts.fallback ?? 'success'
  }

  /** How many times this exact message was accepted upstream. */
  acceptedCount(to: string, message: string): number {
    return this.accepted.filter(a => a.to === to && a.message === message).length
  }

  async send(to: string, message: string): Promise<SendOutcome> {
    this.calls.push({ to, message, at: Date.now() })
    const behaviour = this.script.shift() ?? this.fallback
    const id = `fake-${++this.counter}`

    switch (behaviour) {
      case 'success':
        this.accepted.push({ to, message, id })
        return { ok: true, permanent: false, providerMessageId: id, response: { status: 'success' } }

      case 'slow':
        await new Promise(r => setTimeout(r, 50))
        this.accepted.push({ to, message, id })
        return { ok: true, permanent: false, providerMessageId: id, response: { status: 'success' } }

      case 'timeout':
        // We stopped waiting and the provider did NOT take it.
        return { ok: false, permanent: false, error: 'The operation was aborted due to timeout' }

      case 'timeout_but_accepted':
        // We stopped waiting, but it went out. This is why a retry needs a
        // claim it cannot win twice, not just a "did it fail?" check.
        this.accepted.push({ to, message, id })
        return { ok: false, permanent: false, error: 'The operation was aborted due to timeout' }

      case 'temporary':
        return { ok: false, permanent: false, error: 'Arkesel 503: service unavailable' }

      case 'permanent':
        return { ok: false, permanent: true, error: 'Arkesel 400: No valid number in recipients!' }
    }
  }
}

/* ─────────────────────────────────────────────
   Classifying a real provider response
   ───────────────────────────────────────────── */

/**
 * Is this HTTP status worth trying again?
 *
 * 4xx means the request itself is wrong and will be refused identically; the
 * one exception is 429, where the provider is asking us to slow down rather
 * than saying no. Everything else — 5xx, a timeout, a socket error — is the
 * provider having a moment.
 *
 * Kept here, separate from the network call, so the rule is testable without
 * one.
 */
export function isPermanentFailure(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429
}

/**
 * Conditions Arkesel reports that WILL clear on their own.
 *
 * Everything else it names in an error body is a property of the request —
 * the number, the sender id, the key — and will be refused identically on
 * every retry.
 */
const TRANSIENT_MESSAGE = /balance|insufficient|limit|throttl|try again|timeout|timed out|unavailable|temporar/i

/**
 * Decide whether a failed send is worth retrying, from BOTH the HTTP status
 * and the response body.
 *
 * The HTTP status alone is not enough. Of the twenty-seven real failures in
 * this system, five came back as
 *
 *     {"status":"error","message":"No valid number in recipients!"}
 *
 * which is a flat refusal of the request. Classifying on the status code
 * alone, that is retried four times if Arkesel happened to answer 200 —
 * four guaranteed rejections that delay every real message behind them.
 *
 * A body that names the fault is therefore trusted over the transport code.
 */
export function classifyFailure(status: number, body: unknown): boolean {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (b.status === 'error' || b.code === 'error') {
      const message = typeof b.message === 'string' ? b.message : ''
      // Arkesel named the problem. Retry only if it is one that passes.
      return !TRANSIENT_MESSAGE.test(message)
    }
  }
  return isPermanentFailure(status)
}

/** Pull Arkesel's message id out of a response, whichever shape it arrives in. */
export function extractMessageId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>

  // Arkesel has used several shapes over time; take whichever is present
  // rather than assuming one and silently recording nothing.
  const direct = b.message_id ?? b.messageId ?? b.id
  if (typeof direct === 'string' && direct) return direct

  const data = b.data
  if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
    const first = data[0] as Record<string, unknown>
    const nested = first.message_id ?? first.messageId ?? first.id
    if (typeof nested === 'string' && nested) return nested
  }
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    const nested = d.message_id ?? d.messageId ?? d.id
    if (typeof nested === 'string' && nested) return nested
  }
  return null
}

/**
 * What it means to send a message, independent of who sends it.
 *
 * ── WHY THIS INTERFACE EXISTS ──────────────────────────────────────────────
 *
 * Forty files call sendWhatsAppText and forty-one call sendSMS. None of them
 * should know, or be able to find out, that WhatsApp happens to go through
 * WaSender and text messages through Arkesel — and until now the only thing
 * separating them from that was the fact that nobody had looked.
 *
 * The seam is put here rather than at the call sites deliberately. Both of
 * those functions were already the single door every caller goes through, so
 * the interface goes behind the door: their signatures do not change, eighty-
 * one files are untouched, and what changes is who answers.
 *
 * ── WHAT THIS BUYS TODAY ───────────────────────────────────────────────────
 *
 * The centre has no live WhatsApp line and no live SMS credit, and the whole
 * product has been unverifiable end to end because of it. With a provider
 * chosen by configuration, the same business logic — the same webhook, the
 * same assistant, the same handover, the same notification — can be exercised
 * against a provider that records what it would have sent instead of sending
 * it.
 *
 * That is not a test double standing in for the application. It is the
 * application, with one edge swapped.
 */

export type MessageKind = 'text' | 'media'

export type OutboundMessage = {
  /** The number, as the application holds it. The provider normalises. */
  to: string
  body: string
  kind: MessageKind
  /** For a media message. Ignored for text. */
  mediaUrl?: string | null
  /**
   * Whose line to send from, where the channel supports per-person lines.
   * A provider that has no such concept ignores it.
   */
  senderId?: string | null
}

export type DeliveryResult = {
  ok: boolean
  /** What the provider said, for the log. Never shown to a lead. */
  detail?: string
  /**
   * True when the failure is permanent — a malformed number, a refused
   * recipient. A caller may retry a transient failure and must not retry
   * this one.
   */
  permanent?: boolean
}

export interface MessagingProvider {
  /** A name for logs and for the readiness screen. */
  readonly id: string
  /** False for a provider that records rather than delivers. */
  readonly delivers: boolean
  /** Is this provider able to send at all — keys present, configuration valid? */
  configured(): boolean
  send(message: OutboundMessage): Promise<DeliveryResult>
}

/**
 * A provider that records what would have been sent, and sends nothing.
 *
 * Used while the real channel is deliberately disconnected. It reports
 * success, because from the application's point of view the message left —
 * the business logic that follows a successful send is exactly what needs
 * exercising. What it does not do is reach a person, and `delivers: false`
 * is how every screen says so rather than implying a message arrived.
 */
export class RecordingProvider implements MessagingProvider {
  readonly id: string
  readonly delivers = false

  /** Everything it was asked to send, newest last. Inspectable in tests. */
  readonly outbox: OutboundMessage[] = []

  constructor(id = 'recording') {
    this.id = id
  }

  configured(): boolean { return true }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    this.outbox.push(message)
    return { ok: true, detail: `recorded by ${this.id}, not delivered` }
  }

  /** For a test that wants to assert on one conversation. */
  to(phone: string): OutboundMessage[] {
    const digits = String(phone).replace(/\D/g, '')
    return this.outbox.filter(m => String(m.to).replace(/\D/g, '').endsWith(digits.slice(-9)))
  }

  clear(): void { this.outbox.length = 0 }
}

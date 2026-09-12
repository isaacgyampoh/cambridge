import 'server-only'
import { SECRETS } from '@/lib/config.server'
import { RecordingProvider, type MessagingProvider } from '@/lib/messaging/provider'

export type { MessagingProvider, OutboundMessage, DeliveryResult } from '@/lib/messaging/provider'
export { RecordingProvider } from '@/lib/messaging/provider'

/**
 * Which provider actually sends, for each channel.
 *
 * ── HOW A CHANNEL IS CHOSEN ────────────────────────────────────────────────
 *
 * By whether it is configured, and nothing else. A channel with credentials
 * uses its real provider. A channel without them records instead of sending,
 * and says so everywhere it is asked.
 *
 * That is deliberately not a MOCK_MESSAGING flag. A flag is a second thing to
 * remember and a new way to be wrong — somebody sets it in production and
 * every message silently stops, or forgets it in development and the centre
 * texts a real lead from somebody's laptop. Presence of credentials is the
 * same question asked once, and it cannot disagree with itself.
 *
 * ── WHAT THIS MEANS TODAY ──────────────────────────────────────────────────
 *
 * WhatsApp and SMS are deliberately disconnected. So both record, the whole
 * product runs end to end, and every screen that mentions delivery says the
 * message was recorded rather than sent. When the credentials arrive, nothing
 * in the application changes.
 */

/**
 * The recorder is a module-level singleton on purpose: a development-mode
 * screen and a test both need to read back what the application decided to
 * send, and a new instance per call would have nothing in it.
 */
const recorders = new Map<string, RecordingProvider>()

function recorderFor(channel: string): RecordingProvider {
  const existing = recorders.get(channel)
  if (existing) return existing
  const made = new RecordingProvider(`recording:${channel}`)
  recorders.set(channel, made)
  return made
}

/** Everything the application has tried to send on this channel. */
export function outboxFor(channel: 'whatsapp' | 'sms'): RecordingProvider | null {
  return recorders.get(channel) || null
}

export type ChannelStatus = {
  channel: 'whatsapp' | 'sms'
  provider: string
  /** False when messages are being recorded rather than delivered. */
  delivers: boolean
  configured: boolean
}

/** Is this channel connected to something that actually reaches a person? */
export function whatsappConnected(): boolean {
  return Boolean(SECRETS.wasenderApiKey)
}

export function smsConnected(): boolean {
  return Boolean(SECRETS.arkeselApiKey)
}

/**
 * What each channel is doing, for the readiness screen.
 *
 * A recording channel is NOT a failure. Section 16 of the brief: an
 * integration that is deliberately deferred must not make the core
 * application look broken. It is reported as deferred, separately from
 * whether the product itself works.
 */
export function channelStatuses(): ChannelStatus[] {
  return [
    {
      channel: 'whatsapp',
      provider: whatsappConnected() ? 'wasender' : 'recording:whatsapp',
      delivers: whatsappConnected(),
      configured: whatsappConnected(),
    },
    {
      channel: 'sms',
      provider: smsConnected() ? 'arkesel' : 'recording:sms',
      delivers: smsConnected(),
      configured: smsConnected(),
    },
  ]
}

/**
 * The provider for a channel that is NOT connected.
 *
 * Returns null when the channel has real credentials, because then the
 * existing transport handles it and there is nothing to stand in for.
 */
export function recordingProviderFor(channel: 'whatsapp' | 'sms'): MessagingProvider | null {
  const connected = channel === 'whatsapp' ? whatsappConnected() : smsConnected()
  return connected ? null : recorderFor(channel)
}

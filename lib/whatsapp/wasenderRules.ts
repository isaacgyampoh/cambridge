/**
 * WASENDERAPI — THE RULES, WITH NO NETWORK AND NO SECRETS.
 *
 * Pure and import-free so every rule here is tested directly, against the
 * responses the real API returns (captured 2026-09-22 with a fake key):
 *
 *   GET  /api/status            401 {"success":false,"message":"Session not found for the provided API key"}
 *   POST /api/send-message      401 {"success":false,"message":"invalid API key","help":"please check your WhatsApp session page…"}
 *   GET  /api/on-whatsapp/{id}  401 {"success":false,"message":"invalid API key",…}
 *   GET  /api/whatsapp-sessions 401 {"success":false,"message":"This endpoint requires a valid personal access token.",…}
 *
 * ── WHY "INVALID API" ──────────────────────────────────────────────────────
 *
 * "invalid API key" is WasenderAPI's own reply to a key it does not
 * recognise, and the portal showed it verbatim. Three things produce it while
 * the session itself is perfectly healthy in the Wasender dashboard:
 *
 *   1. A PERSONAL ACCESS TOKEN pasted where the SESSION API KEY belongs. They
 *      are different credentials: the session key (on the session's own
 *      page) sends messages and reads the session status; the access token
 *      (Settings → Personal Access Token) only manages the account. Both are
 *      long random strings and nothing on screen told them apart.
 *   2. A key pasted with a trailing newline, surrounding quotes or a
 *      "Bearer " prefix, stored exactly as pasted.
 *   3. A key from a session that has since been deleted or recreated —
 *      "API Keys are tied to a specific session. If the session is deleted,
 *      the key becomes invalid."
 *
 * And the line showed "Connecting" because the screen itself wrote
 * 'connecting' on save and nothing ever asked WasenderAPI.
 */

/** The API as the documentation writes it. */
export const WASENDER_BASE = 'https://www.wasenderapi.com'

/**
 * Clean a pasted key before it is stored or sent.
 *
 * Removes what a copy-paste drags along — whitespace and newlines anywhere,
 * wrapping quotes, and a "Bearer " / "Bearer token " prefix copied from the
 * docs' example header. Never changes the characters of the key itself.
 */
export function normaliseWasenderKey(raw: string | null | undefined): string {
  let k = String(raw ?? '').trim()
  k = k.replace(/^authorization\s*:\s*/i, '')
  k = k.replace(/^bearer\s+(token\s+)?/i, '')
  k = k.replace(/^["'`]+|["'`]+$/g, '')
  k = k.replace(/\s+/g, '')
  return k
}

/** Enough to recognise a key, never enough to use one: "••••1a2b (64 chars)". */
export function keyFingerprint(key: string | null | undefined): string | null {
  const k = String(key ?? '')
  if (!k) return null
  return `••••${k.slice(-4)} (${k.length} chars)`
}

export type SessionStatus =
  | 'connected' | 'connecting' | 'disconnected' | 'need_scan'
  | 'need_passkey' | 'logged_out' | 'expired'

export const SESSION_STATUSES: readonly SessionStatus[] = [
  'connected', 'connecting', 'disconnected', 'need_scan', 'need_passkey', 'logged_out', 'expired',
]

/** The seven documented states, in words an administrator acts on. */
export function describeSessionStatus(status: string | null | undefined): {
  label: string; tone: 'success' | 'warning' | 'danger' | 'muted'; action: string
} {
  switch (status) {
    case 'connected':    return { label: 'Connected', tone: 'success', action: 'Ready to send and receive messages.' }
    case 'connecting':   return { label: 'Connecting', tone: 'warning', action: 'WhatsApp is still connecting. Wait a moment and check again.' }
    case 'need_scan':    return { label: 'Needs QR scan', tone: 'warning', action: 'Open the session in WasenderAPI and scan the QR code with the phone.' }
    case 'need_passkey': return { label: 'Needs passkey', tone: 'warning', action: 'Approve the passkey link request for this session in WasenderAPI.' }
    case 'disconnected': return { label: 'Disconnected', tone: 'danger', action: 'WhatsApp is disconnected. Reconnect the session in WasenderAPI.' }
    case 'logged_out':   return { label: 'Logged out', tone: 'danger', action: 'WhatsApp was logged out on the phone. Reconnect the session in WasenderAPI.' }
    case 'expired':      return { label: 'Expired', tone: 'danger', action: 'The session has expired. Reconnect it in WasenderAPI.' }
    default:             return { label: 'Not checked', tone: 'muted', action: 'Check the line to read its status from WasenderAPI.' }
  }
}

export function isSessionStatus(v: unknown): v is SessionStatus {
  return typeof v === 'string' && (SESSION_STATUSES as readonly string[]).includes(v)
}

export type FailureKind =
  | 'missing_key'
  | 'personal_access_token'
  | 'auth'
  | 'session_not_connected'
  | 'invalid_recipient'
  | 'validation'
  | 'subscription'
  | 'rate_limited'
  | 'provider'
  | 'network'

/** What an administrator is told for each kind of failure. Never the key. */
export const FAILURE_MESSAGE: Record<FailureKind, string> = {
  missing_key:
    'No WasenderAPI key is set for this line.',
  personal_access_token:
    'This is a WasenderAPI Personal Access Token, not the session API key. In WasenderAPI open the WhatsApp session itself, copy its API key, and paste that here instead.',
  auth:
    'WasenderAPI authentication failed. WasenderAPI does not recognise this key — copy the API key again from the WhatsApp session’s own page in WasenderAPI (if the session was deleted and recreated, its key changed).',
  session_not_connected:
    'WhatsApp is not connected. Reconnect the WhatsApp session in WasenderAPI.',
  invalid_recipient:
    'The phone number is not a valid WhatsApp contact.',
  validation:
    'WasenderAPI rejected the request as incomplete or malformed.',
  subscription:
    'WasenderAPI refused the request for this account (subscription or plan limit).',
  rate_limited:
    'WasenderAPI is rate limiting this account. Wait a minute and try again.',
  provider:
    'WasenderAPI returned an error. Please try again.',
  network:
    'Unable to reach WasenderAPI.',
}

/**
 * Turn an HTTP status and body into one kind of failure, or null for success.
 *
 * Only a 401 is an authentication failure. A 403 is a plan or permission
 * problem, 404 a wrong endpoint, 422 a bad payload, 429 a rate limit, 5xx the
 * provider — previously every one of them surfaced as "Invalid API".
 */
export function classifyWasender(httpStatus: number, body: unknown): FailureKind | null {
  const b = (body && typeof body === 'object' ? body : {}) as { success?: unknown; message?: unknown }
  const msg = String(b.message ?? '').toLowerCase()

  if (httpStatus >= 200 && httpStatus < 300 && b.success !== false) return null

  if (/personal access token/.test(msg)) return 'personal_access_token'
  if (httpStatus === 401 || /invalid api key|api key is required|session not found for the provided api key|unauthori[sz]ed|unnotarized/.test(msg)) return 'auth'
  if (/not connected|session is not connected|disconnected|logged out|need(s)? (to )?scan/.test(msg)) return 'session_not_connected'
  if (httpStatus === 429 || /rate limit|too many/.test(msg)) return 'rate_limited'
  if (httpStatus === 402 || /subscription|plan|trial|upgrade/.test(msg)) return 'subscription'
  if (httpStatus === 403) return 'subscription'
  if (/not on whatsapp|not registered|invalid (phone|number|recipient)|does not exist/.test(msg)) return 'invalid_recipient'
  if (httpStatus === 422 || httpStatus === 400) return 'validation'
  return 'provider'
}

/**
 * Remove credentials from a webhook body before it is stored.
 *
 * WasenderAPI puts the session's own API key in every event as `sessionId`
 * ({"event":"session.status","sessionId":"YOUR_SESSION_API_KEY",…}). The
 * webhook stored the whole body in webhook_inbox.raw, which the raw-webhooks
 * screen reads back — so the key was written to the database and shown to
 * whoever opened that screen.
 */
const SECRET_FIELD = /^(sessionid|session_id|apikey|api_key|token|access_token|authorization|secret|webhooksecret|webhook_secret)$/i

export function redactWebhook(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]'
  if (Array.isArray(value)) return value.map(v => redactWebhook(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_FIELD.test(k) ? '[redacted]' : redactWebhook(v, depth + 1)
    }
    return out
  }
  return value
}

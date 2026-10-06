import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { SECRETS } from '@/lib/config.server'
import { canonicalGhanaMobile } from '@/lib/phone'
import {
  WASENDER_BASE, normaliseWasenderKey, classifyWasender, isSessionStatus,
  FAILURE_MESSAGE, type FailureKind, type SessionStatus,
} from '@/lib/whatsapp/wasenderRules'

/**
 * THE ONE PLACE THE PORTAL TALKS TO WASENDERAPI ABOUT A LINE.
 *
 * Browser → this server → WasenderAPI. The key never leaves the server: it
 * is read here, sent in the Authorization header, and nothing returned from
 * this module contains it.
 *
 * Every call goes to the documented endpoint with the documented header —
 *   Authorization: Bearer <session API key>
 * and every failure comes back classified, so the screen says which of
 * authentication, a disconnected session, a bad number or an unreachable
 * provider it was, instead of forwarding WasenderAPI's "invalid API key".
 */

const TIMEOUT_MS = 10_000

type Call = { ok: true; http: number; body: any } | { ok: false; kind: FailureKind; http: number | null; providerMessage: string | null }

async function call(key: string, method: 'GET' | 'POST', path: string, payload?: unknown): Promise<Call> {
  if (!key) return { ok: false, kind: 'missing_key', http: null, providerMessage: null }
  let res: Response
  try {
    res = await fetch(`${WASENDER_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (e) {
    // The message of a failed fetch can include the URL; the key is in a
    // header, not the URL, but nothing from here is echoed regardless.
    console.error('[wasender]', method, path, 'unreachable:', e instanceof Error ? e.name : 'error')
    return { ok: false, kind: 'network', http: null, providerMessage: null }
  }

  /*
   * Reading the body can fail too — an aborted or truncated stream rejects
   * here. That used to escape call() entirely, and because the status page
   * checks every line in one Promise.all, a single truncated response blanked
   * the whole page with a 500. A failed read is a network failure like any
   * other, and is reported as one.
   */
  let raw: string
  try {
    raw = await res.text()
  } catch (e) {
    console.error('[wasender]', method, path, 'body unreadable:', e instanceof Error ? e.name : 'error')
    return { ok: false, kind: 'network', http: res.status, providerMessage: null }
  }

  let body: any
  try { body = JSON.parse(raw) } catch { body = { message: raw.slice(0, 200) } }

  const kind = classifyWasender(res.status, body)
  if (!kind) return { ok: true, http: res.status, body }

  // Logged without the key; the provider's message is safe to keep.
  console.error('[wasender]', method, path, res.status, kind, String(body?.message ?? '').slice(0, 160))
  return { ok: false, kind, http: res.status, providerMessage: body?.message ? String(body.message).slice(0, 200) : null }
}

export type Credential = { key: string; source: 'line' | 'central'; profileId: string | null }

/**
 * Which key a line uses. A line (a staff profile with its own session) uses
 * its own key; otherwise the central WASENDER_API_KEY from the server
 * environment. Never "the first session" and never a hard-coded one.
 */
export async function credentialFor(profileId: string | null | undefined): Promise<Credential | { error: string }> {
  if (profileId) {
    const sb = createServiceClient()
    const { data, error } = await sb.from('profiles')
      .select('wasender_api_key').eq('id', profileId).maybeSingle()
    if (error) return { error: 'That WhatsApp line could not be loaded just now.' }
    const key = normaliseWasenderKey(data?.wasender_api_key as string | null)
    if (!key) return { error: FAILURE_MESSAGE.missing_key }
    return { key, source: 'line', profileId }
  }
  const key = normaliseWasenderKey(SECRETS.wasenderApiKey)
  if (!key) return { error: 'No central WasenderAPI key (WASENDER_API_KEY) is set on the server.' }
  return { key, source: 'central', profileId: null }
}

export type StatusResult =
  | { ok: true; status: SessionStatus }
  | { ok: false; kind: FailureKind; message: string; http: number | null }

/**
 * GET /api/status — the session's real state, as WasenderAPI reports it.
 *
 * When the key is refused, the same key is tried against an account-level
 * endpoint: if THAT accepts it, what was pasted is a Personal Access Token,
 * and the administrator is told exactly that.
 */
export async function sessionStatus(key: string): Promise<StatusResult> {
  const r = await call(key, 'GET', '/api/status')
  if (r.ok) {
    const status = r.body?.status ?? r.body?.data?.status
    if (isSessionStatus(status)) return { ok: true, status }
    return { ok: false, kind: 'provider', message: `WasenderAPI returned an unrecognised status (${String(status).slice(0, 40)}).`, http: r.http }
  }

  if (r.kind === 'auth') {
    const pat = await call(key, 'GET', '/api/whatsapp-sessions')
    if (pat.ok) {
      return { ok: false, kind: 'personal_access_token', message: FAILURE_MESSAGE.personal_access_token, http: r.http }
    }
  }
  return { ok: false, kind: r.kind, message: FAILURE_MESSAGE[r.kind], http: r.http }
}

export type ContactResult =
  | { ok: true; exists: boolean; number: string }
  | { ok: false; kind: FailureKind; message: string; http: number | null }

/** GET /api/on-whatsapp/{contact} — is this number on WhatsApp? */
export async function checkContact(key: string, rawPhone: string): Promise<ContactResult> {
  const number = canonicalGhanaMobile(rawPhone)
  if (!number) {
    return { ok: false, kind: 'invalid_recipient', http: null,
      message: 'That is not a valid Ghanaian mobile number. Use a number such as 0241234567 or +233241234567.' }
  }
  // The documented form is international with a leading +, URL-encoded in the path.
  const r = await call(key, 'GET', `/api/on-whatsapp/${encodeURIComponent(`+${number}`)}`)
  if (!r.ok) return { ok: false, kind: r.kind, message: FAILURE_MESSAGE[r.kind], http: r.http }
  return { ok: true, exists: r.body?.data?.exists === true, number }
}

export type SendResult =
  | { ok: true; number: string; messageId: string | null; http: number }
  | { ok: false; kind: FailureKind; message: string; http: number | null; number: string | null }

/** POST /api/send-message — a real message, returning the provider's id. */
export async function sendText(key: string, rawPhone: string, text: string): Promise<SendResult> {
  const number = canonicalGhanaMobile(rawPhone)
  if (!number) {
    return { ok: false, kind: 'invalid_recipient', http: null, number: null,
      message: 'That is not a valid Ghanaian mobile number. Use a number such as 0241234567 or +233241234567.' }
  }
  const r = await call(key, 'POST', '/api/send-message', { to: number, text })
  if (!r.ok) return { ok: false, kind: r.kind, message: FAILURE_MESSAGE[r.kind], http: r.http, number }
  const d = r.body?.data ?? {}
  const messageId = d.msgId ?? d.messageId ?? d.id ?? d.key?.id ?? null
  return { ok: true, number, messageId: messageId !== null ? String(messageId) : null, http: r.http }
}

/**
 * Store what WasenderAPI said about a line, so the rest of the portal shows
 * the truth. Only real answers are stored: a network failure says nothing
 * about the session and must not overwrite a good status.
 */
export async function recordLineStatus(profileId: string, result: StatusResult): Promise<void> {
  let value: string | null = null
  if (result.ok) value = result.status
  else if (result.kind === 'auth' || result.kind === 'personal_access_token' || result.kind === 'missing_key') value = 'invalid_key'
  if (!value) return
  const sb = createServiceClient()
  await sb.from('profiles').update({ wasender_status: value }).eq('id', profileId).then(() => {}, () => {})
}

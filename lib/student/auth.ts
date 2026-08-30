import 'server-only'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { SECRETS } from '@/lib/config.server'

export const STUDENT_COOKIE = 'cce_student'

/** How long a sign-in link stays usable, and how long a session lasts. */
const LINK_HOURS = 24 * 14      // 14 days
const SESSION_DAYS = 90

export function normalisePhone(p: string): string[] {
  const d = String(p || '').replace(/[^0-9]/g, '')
  const local = d.replace(/^233/, '0')
  const intl = d.replace(/^0/, '233')
  return Array.from(new Set([d, local, intl, '+' + intl].filter(Boolean)))
}

/**
 * One-way hash for student login and session tokens.
 *
 * Both were previously stored in plaintext, so anyone who could read
 * student_sessions — a table that had no row-level security at all until
 * migration 0004 — could impersonate any student for ninety days.
 */
function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value + SECRETS.pinPepper).digest('hex')
}

/** Create a one-time sign-in token and return the raw value for the link. */
export async function createLoginToken(leadId: string, phone: string): Promise<string> {
  const sb = createServiceClient()
  const raw = crypto.randomBytes(24).toString('hex')

  await sb.from('student_sessions').insert({
    lead_id: leadId,
    phone,
    login_token: hashToken(raw),
    token_used: false,
    expires_at: new Date(Date.now() + LINK_HOURS * 3600_000).toISOString(),
  })

  return raw
}

/**
 * Exchange a one-time sign-in token for a session.
 *
 * THE TOKEN IS NOW ACTUALLY ONE-TIME. The previous version set
 * `token_used: true` but never read it back:
 *
 *     const { data: row } = await sb.from('student_sessions')
 *       .select('*').eq('login_token', login_token).maybeSingle()
 *     if (!row) return null
 *     // nothing here ever looked at row.token_used
 *
 * so the sign-in link sent over WhatsApp or SMS stayed redeemable for its full
 * fourteen days by anyone who saw it — a forwarded message, a shared handset,
 * a phone backup — and each redemption minted a fresh ninety-day session.
 *
 * The claim is a conditional UPDATE rather than a read followed by a write, so
 * two simultaneous redemptions cannot both succeed: exactly one matches the
 * `token_used = false` predicate and the other comes back empty.
 */
export async function redeemToken(
  login_token: string
): Promise<{ session_token: string; leadId: string } | null> {
  if (!login_token) return null

  const sb = createServiceClient()
  const session_token = crypto.randomBytes(32).toString('hex')

  const { data: claimed, error } = await sb.from('student_sessions')
    .update({
      token_used: true,
      session_token: hashToken(session_token),
      expires_at: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(),
      last_seen_at: new Date().toISOString(),
    })
    .eq('login_token', hashToken(login_token))
    .eq('token_used', false)                       // ← the claim
    .gt('expires_at', new Date().toISOString())    // ← and it must not have expired
    .select('lead_id')
    .maybeSingle()

  if (error) {
    console.error('[student auth] redeem failed:', error.message)
    return null
  }
  if (!claimed) return null   // already used, expired, or never existed

  return { session_token, leadId: claimed.lead_id as string }
}

/** Validate a session cookie. Returns the student's lead id, or null. */
export async function verifyStudent(
  session_token?: string | null
): Promise<{ leadId: string } | null> {
  if (!session_token) return null

  const sb = createServiceClient()
  const { data: row } = await sb.from('student_sessions')
    .select('id, lead_id, expires_at')
    .eq('session_token', hashToken(session_token))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (!row) return null

  // Touch last_seen without blocking the request.
  sb.from('student_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(() => {}, () => {})

  return { leadId: row.lead_id as string }
}

/** End a student session. */
export async function endStudentSession(session_token?: string | null): Promise<void> {
  if (!session_token) return
  const sb = createServiceClient()
  await sb.from('student_sessions')
    .update({ expires_at: new Date(0).toISOString(), session_token: null })
    .eq('session_token', hashToken(session_token))
    .then(() => {}, () => {})
}

/** Cookie options for the student session, in one place. */
export const STUDENT_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: SESSION_DAYS * 86_400,
  path: '/',
}

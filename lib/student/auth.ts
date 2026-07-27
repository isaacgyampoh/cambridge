import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'

export const STUDENT_COOKIE = 'cce_student'

export function normalisePhone(p: string): string[] {
  const d = String(p || '').replace(/[^0-9]/g, '')
  const local = d.replace(/^233/, '0')
  const intl = d.replace(/^0/, '233')
  return Array.from(new Set([d, local, intl, '+' + intl].filter(Boolean)))
}

/** Create a one-time login token for a student and return the link path. */
export async function createLoginToken(leadId: string, phone: string) {
  const sb = createServiceClient()
  const login_token = crypto.randomBytes(24).toString('hex')
  await sb.from('student_sessions').insert({
    lead_id: leadId, phone, login_token,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(), // link valid 14 days
  })
  return login_token
}

/** Exchange a one-time token for a long-lived session token. */
export async function redeemToken(login_token: string) {
  const sb = createServiceClient()
  const { data: row } = await sb.from('student_sessions')
    .select('*').eq('login_token', login_token).maybeSingle()
  if (!row) return null
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null

  const session_token = crypto.randomBytes(32).toString('hex')
  await sb.from('student_sessions').update({
    token_used: true, session_token,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString(), // stay signed in 90 days
    last_seen_at: new Date().toISOString(),
  }).eq('id', row.id)
  return { session_token, leadId: row.lead_id as string }
}

/** Validate a session cookie. Returns the student's lead id. */
export async function verifyStudent(session_token?: string | null) {
  if (!session_token) return null
  const sb = createServiceClient()
  const { data: row } = await sb.from('student_sessions')
    .select('id, lead_id, expires_at').eq('session_token', session_token).maybeSingle()
  if (!row) return null
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null
  sb.from('student_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', row.id).then(() => {}, () => {})
  return { leadId: row.lead_id as string }
}

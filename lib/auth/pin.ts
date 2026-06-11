import { createServiceClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { createHash, randomBytes } from 'crypto'

const SESSION_COOKIE = 'cce_session'
const SESSION_HOURS = 8

// Simple SHA-256 hash for PIN (no bcrypt needed on Vercel Edge)
export function hashPIN(pin: string): string {
  return createHash('sha256').update(pin + process.env.PIN_SALT || 'cce-salt-2024').digest('hex')
}

export function verifyPIN(pin: string, hash: string): boolean {
  return hashPIN(pin) === hash
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

// ── Create a session after successful PIN verification ────────
export async function createSession(userId: string, ipAddress?: string): Promise<string> {
  const sb = createServiceClient()
  const token = generateSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString()

  // Clean old sessions for this user
  await sb.from('pin_sessions').delete().eq('user_id', userId)

  await sb.from('pin_sessions').insert({
    user_id: userId,
    session_token: token,
    ip_address: ipAddress || null,
    expires_at: expiresAt,
  })

  return token
}

// ── Verify a session token from cookie ────────────────────────
export async function verifySession(token: string): Promise<{
  valid: boolean
  userId?: string
  role?: string
  fullName?: string
  email?: string
} > {
  if (!token) return { valid: false }

  const sb = createServiceClient()
  const { data } = await sb.from('pin_sessions')
    .select('user_id, expires_at, profiles(role, full_name, email, is_active)')
    .eq('session_token', token)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (!data) return { valid: false }

  const profile = (data as any).profiles
  if (!profile?.is_active) return { valid: false }

  return {
    valid: true,
    userId: data.user_id,
    role: profile.role,
    fullName: profile.full_name,
    email: profile.email,
  }
}

// ── Get session from request cookies ──────────────────────────
export async function getSessionFromCookies(): Promise<ReturnType<typeof verifySession>> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return { valid: false }
  return verifySession(token)
}

// ── Role → portal mapping ─────────────────────────────────────
export const ROLE_PORTAL: Record<string, string> = {
  super_admin: '/admin',
  project_manager: '/pm',
  marketing_officer: '/marketer',
  admissions_officer: '/admission',
  accountant: '/finance',
  receptionist: '/receptionist',
  trainer: '/trainer',
  student: '/student',
}

// ── Role → allowed path prefixes ──────────────────────────────
export const ROLE_ALLOWED_PATHS: Record<string, string[]> = {
  super_admin: ['/admin', '/api'],
  project_manager: ['/pm', '/api/leads', '/api/admissions', '/api/reminders'],
  marketing_officer: ['/marketer', '/api/leads', '/api/reminders'],
  admissions_officer: ['/admission', '/api/admissions', '/api/documents'],
  accountant: ['/finance', '/api/finance'],
  receptionist: ['/receptionist', '/api/reminders', '/api/attendance'],
  trainer: ['/trainer', '/api/attendance'],
  student: ['/student'],
}

export { SESSION_COOKIE }

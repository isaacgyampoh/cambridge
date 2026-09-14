import 'server-only'
import { SECRETS } from '@/lib/config.server'
import { createServiceClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto'
import { promisify } from 'util'

const scrypt = promisify(_scrypt) as (
  secret: string, salt: Buffer, keylen: number
) => Promise<Buffer>

const SESSION_COOKIE = 'cce_session'
const SESSION_HOURS = 8

/**
 * The salt used by the ORIGINAL PIN scheme, which was a single fast SHA-256
 * round over `pin + salt` with this one salt shared by every user.
 *
 * It is reproduced here only so that PINs set before the migration can still
 * be verified — otherwise every member of staff would be locked out at once.
 * The value is already public (it shipped inside the browser bundle for
 * months), so recording it in a server-only file discloses nothing new.
 *
 * Any PIN verified through this path is immediately re-hashed with scrypt,
 * and the migration sets must_change_pin on every account, so this path
 * disappears as people sign in.
 */
const LEGACY_SALT = 'cce-pin-salt-cambridge-2024'

// ── PIN hashing ───────────────────────────────────────────────
// scrypt with a per-user random salt plus a server-side pepper. The pepper
// lives only in the environment, so a database dump alone is not enough to
// mount an offline attack — which matters a great deal when the secret being
// protected is a 4-digit number with only 10,000 possible values.

const KEYLEN = 64

/** Hash a PIN for storage. Returns `scrypt$<saltHex>$<hashHex>`. */
export async function hashPIN(pin: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(pin + SECRETS.pinPepper, salt, KEYLEN)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

/**
 * Verify a PIN against a stored hash. Understands both the new scrypt format
 * and the legacy SHA-256 format. Comparison is timing-safe.
 *
 * Returns `{ ok, needsRehash }` — when `needsRehash` is true the caller should
 * store a fresh `hashPIN()` result to migrate the account off the old scheme.
 */
export async function verifyPIN(
  pin: string,
  stored: string
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (!pin || !stored) return { ok: false, needsRehash: false }

  if (stored.startsWith('scrypt$')) {
    const [, saltHex, hashHex] = stored.split('$')
    if (!saltHex || !hashHex) return { ok: false, needsRehash: false }
    const expected = Buffer.from(hashHex, 'hex')
    const actual = await scrypt(pin + SECRETS.pinPepper, Buffer.from(saltHex, 'hex'), KEYLEN)
    if (expected.length !== actual.length) return { ok: false, needsRehash: false }
    return { ok: timingSafeEqual(expected, actual), needsRehash: false }
  }

  // Legacy: single SHA-256 over pin + shared salt.
  const legacy = createHash('sha256').update(pin + LEGACY_SALT).digest()
  const expected = Buffer.from(stored, 'hex')
  if (expected.length !== legacy.length) return { ok: false, needsRehash: false }
  const ok = timingSafeEqual(expected, legacy)
  return { ok, needsRehash: ok }
}

// ── Short-lived codes and opaque tokens ───────────────────────
// Session tokens and OTPs are not passwords: a session token carries 256 bits
// of entropy, and an OTP is attempt-limited and expires in minutes. A single
// fast hash is the right tool for both — it keeps the lookup a cheap indexed
// equality check while ensuring a database dump yields nothing replayable.

/** One-way hash for session tokens and OTP codes. */
export function hashToken(value: string): string {
  return createHash('sha256').update(value + SECRETS.pinPepper).digest('hex')
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

/** A numeric one-time code from a cryptographic source, not Math.random(). */
export function generateOTP(digits = 6): string {
  const max = 10 ** digits
  const min = 10 ** (digits - 1)
  const range = max - min
  // Rejection-sample to keep the distribution uniform.
  let n: number
  do {
    n = randomBytes(4).readUInt32BE(0)
  } while (n >= Math.floor(0xffffffff / range) * range)
  return String(min + (n % range))
}

// ── Sessions ──────────────────────────────────────────────────

/**
 * Create a session and return the raw token for the cookie. Only a hash of
 * the token is stored, so a leaked database backup cannot be used to
 * impersonate anyone.
 */
export async function createSession(userId: string, ipAddress?: string): Promise<string> {
  const sb = createServiceClient()
  const token = generateSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString()

  // Clear out expired rows for this user. Live sessions on other devices are
  // deliberately left alone — people work on a laptop and a phone at once.
  await sb.from('pin_sessions')
    .delete().eq('user_id', userId).lt('expires_at', new Date().toISOString())

  // Cap concurrent sessions, dropping the oldest beyond the limit.
  const { data: live } = await sb.from('pin_sessions')
    .select('id').eq('user_id', userId).order('created_at', { ascending: false })
  if ((live || []).length >= 8) {
    const stale = (live || []).slice(7).map((r: { id: string }) => r.id)
    if (stale.length) await sb.from('pin_sessions').delete().in('id', stale)
  }

  await sb.from('pin_sessions').insert({
    user_id: userId,
    session_token: hashToken(token),
    ip_address: ipAddress || null,
    expires_at: expiresAt,
  })

  return token
}

export type SessionInfo = {
  valid: boolean
  userId?: string
  role?: string
  fullName?: string
  email?: string
  phone?: string
  portals?: string[] | null
  /**
   * Set when the session could not be CHECKED, as distinct from being absent
   * or expired.
   *
   * Both used to arrive as `{ valid: false }`, and every caller reads that as
   * "signed out" — so one unreadable moment told every member of staff their
   * session had expired, on every request at once. It is the same distinction
   * the proxy draws before this is ever reached; this is the layer beneath it,
   * used by every API route through requireSession.
   */
  failed?: string
}

/** Resolve a raw session token to its user, or `{ valid: false }`. */
export async function verifySession(token: string): Promise<SessionInfo> {
  if (!token) return { valid: false }

  const sb = createServiceClient()
  const { data, error } = await sb.from('pin_sessions')
    .select('user_id, expires_at, profiles(role, full_name, email, phone, portals, is_active)')
    .eq('session_token', hashToken(token))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  // Not signed out — unknown. The caller decides, and access still fails
  // closed, but nobody is told something untrue about their account.
  if (error) {
    console.error('[auth] session lookup failed:', error.message)
    return { valid: false, failed: error.message }
  }

  if (!data) return { valid: false }

  // PostgREST types an embedded to-one relationship as an array, though it
  // returns a single object. Normalise both shapes.
  type EmbeddedProfile = {
    role: string; full_name: string; email: string
    phone: string; portals: string[] | null; is_active: boolean
  }
  const embedded = (data as unknown as { profiles: EmbeddedProfile | EmbeddedProfile[] | null }).profiles
  const profile = Array.isArray(embedded) ? embedded[0] : embedded
  if (!profile?.is_active) return { valid: false }

  return {
    valid: true,
    userId: data.user_id as string,
    role: profile.role,
    fullName: profile.full_name,
    email: profile.email,
    phone: profile.phone,
    portals: profile.portals,
  }
}

/** Read and verify the session from the request cookies. */
export async function getSessionFromCookies(): Promise<SessionInfo> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return { valid: false }
  return verifySession(token)
}

/** Invalidate a single session (logout). */
export async function destroySession(token: string): Promise<void> {
  if (!token) return
  const sb = createServiceClient()
  await sb.from('pin_sessions').delete().eq('session_token', hashToken(token))
}

/** The cookie options used for the session cookie, in one place. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: SESSION_HOURS * 3600,
  path: '/',
}

// ── Role → landing portal ─────────────────────────────────────
export const ROLE_PORTAL: Record<string, string> = {
  super_admin: '/admin',
  administrator: '/admin',
  project_manager: '/pm',
  marketing_officer: '/marketer',
  admissions_officer: '/admission',
  accountant: '/finance',
  receptionist: '/receptionist',
  trainer: '/trainer',
  exam_coordinator: '/coordinator',
  content_manager: '/content',
  student: '/student',
}

export { SESSION_COOKIE, SESSION_HOURS }

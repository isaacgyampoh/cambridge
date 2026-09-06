import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { ROLE_HOME, resolvePortals } from '@/lib/access/portals'
import { canReachApi } from '@/lib/access/apiAccess'
import { canReachPage } from '@/lib/access/pageAccess'

/*
 * Route guard and security headers.
 *
 * Renamed from middleware.ts: the `middleware` file convention is deprecated
 * in Next.js 16 and has been replaced by `proxy`, which also now defaults to
 * the Node.js runtime instead of Edge.
 *
 * Env vars are read directly rather than through lib/config.server, because
 * Proxy is bundled separately and the docs are explicit that it "should not
 * attempt relying on shared modules or globals".
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ''

/** Paths reachable without a session. Order matters only for readability. */
const PUBLIC = [
  '/certificate/', '/testimonial/', '/api/testimonials/',
  '/login', '/setup', '/apply/', '/refer', '/f/', '/j/', '/signin/', '/public-alumni',
  '/portal', '/class/',
  '/api/student/', '/api/auth/', '/api/setup/', '/api/signin/',
  '/api/classes/signin', '/api/classes/pay', '/api/fees/pay',
  '/api/webhooks/', '/api/applications/', '/api/referrals/submit',
  '/api/auth/recover/',
  '/api/courses/public', '/api/paystack/key', '/api/paystack/init', '/api/paystack/verify',
  '/api/flyers/public', '/api/flyers/submit',
  // decides its own auth per folder: public submission folders are open,
  // everything else requires a session (see app/api/upload/route.ts)
  '/api/upload',
  '/_next', '/favicon',
  // PWA essentials — must be reachable or the browser will not install the app
  '/manifest.json', '/sw.js', '/icons/', '/brand/',
]

/**
 * Scheduled-job endpoints. These carry a shared secret INSTEAD of a session
 * cookie, and each one verifies that secret itself via isValidCronRequest.
 *
 * The previous guard let through ANY /api request that merely carried a `key`
 * query parameter, without ever looking at its value — so appending `?key=x`
 * to a protected path skipped the session and role check entirely, and the
 * forty-four routes with no auth of their own were wide open. Only these
 * specific prefixes are exempt now, and only because they authenticate
 * themselves.
 */
const CRON_PATHS = [
  '/api/cron/run',
  '/api/sms/queue',
  '/api/maintenance/prune',
  '/api/class-reminders/run',
  '/api/payment-reminders/run',
  '/api/info-sessions/run',
  '/api/info-sessions/followup',
  '/api/sequences/run',
  '/api/reports/generate',
  '/api/leads/notify-pending',
  '/api/leads/onboarding',
  '/api/leads/followup',
  '/api/tiers/recalc',
  '/api/prep/reminders',
  '/api/attendance/auto-send',
  '/api/finance/payment-reminder',
  '/api/classes/start-reminders',
  '/api/paystack/reconcile',
]

function isMatch(pathname: string, list: string[]): boolean {
  return list.some(p =>
    p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + '/')
  )
}

/**
 * Security headers, applied to every response.
 *
 * The CSP allows what the app genuinely loads: Paystack's checkout script,
 * Supabase over HTTPS and websockets, and the image hosts in use. It is
 * deliberately not `strict-dynamic` with a nonce, because this app renders
 * many static pages that a nonce cannot reach; the value here is a real
 * tightening over having no policy at all, without breaking payments.
 */
function securityHeaders(res: NextResponse, isDev: boolean): NextResponse {
  const supabaseHost = SUPABASE_URL.replace(/^https?:\/\//, '')
  const csp = [
    "default-src 'self'",
    // 'unsafe-inline' is required by Next's inlined bootstrap and by Paystack.
    // 'unsafe-eval' is needed by React's dev tooling only.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://js.paystack.co https://checkout.paystack.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} https://api.paystack.co https://api.cloudinary.com`,
    "frame-src 'self' https://checkout.paystack.com https://js.paystack.co",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')

  res.headers.set('Content-Security-Policy', csp)
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(self)')
  if (!isDev) {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }
  return res
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isDev = process.env.NODE_ENV === 'development'
  const pass = () => securityHeaders(NextResponse.next(), isDev)
  const goto = (path: string) => securityHeaders(
    NextResponse.redirect(new URL(path, request.url)), isDev
  )

  if (isMatch(pathname, PUBLIC)) return pass()
  if (pathname === '/') return goto('/login')

  // Scheduled jobs authenticate themselves inside the handler.
  if (isMatch(pathname, CRON_PATHS)) return pass()

  const token = request.cookies.get('cce_session')?.value
  if (!token) {
    return pathname.startsWith('/api/')
      ? securityHeaders(NextResponse.json({ error: 'Please sign in to continue.' }, { status: 401 }), isDev)
      : goto('/login')
  }

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('[proxy] SUPABASE_URL or SUPABASE_SERVICE_KEY is not set — refusing all authenticated traffic.')
      return goto('/login')
    }

    const sb = createSupabase(SUPABASE_URL, SERVICE_KEY)
    // Tokens are stored hashed, so look up by the hash. The pepper matches
    // hashToken() in lib/auth/pin.ts.
    const tokenHash = createHash('sha256')
      .update(token + (process.env.PIN_PEPPER || '')).digest('hex')

    const { data } = await sb.from('pin_sessions')
      .select('user_id, expires_at, profiles(role, is_active, portals)')
      .eq('session_token', tokenHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (!data) {
      const res = pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Your session has expired. Please sign in again.' }, { status: 401 })
        : NextResponse.redirect(new URL('/login', request.url))
      res.cookies.set('cce_session', '', { path: '/', maxAge: 0 })
      return securityHeaders(res, isDev)
    }

    type P = { role: string; is_active: boolean; portals: string[] | null }
    const embedded = (data as unknown as { profiles: P | P[] | null }).profiles
    const profile = Array.isArray(embedded) ? embedded[0] : embedded

    if (!profile?.is_active) {
      const res = NextResponse.redirect(new URL('/login', request.url))
      res.cookies.set('cce_session', '', { path: '/', maxAge: 0 })
      return securityHeaders(res, isDev)
    }

    const role = profile.role
    if (role === 'super_admin') return pass()

    const portals = resolvePortals(role, profile.portals)

    // API access is now derived from the user's portals, exactly as page
    // access is — not from one flat list handed to everybody.
    if (pathname.startsWith('/api/')) {
      return canReachApi(pathname, role, portals)
        ? pass()
        : securityHeaders(
            NextResponse.json({ error: 'You do not have access to this.' }, { status: 403 }),
            isDev
          )
    }

    // The same predicate the navigation is built from, so a menu can never
    // offer a link this would refuse. See lib/access/pageAccess.ts.
    if (!canReachPage(pathname, role, portals)) return goto(ROLE_HOME[role] || '/login')

    return pass()
  } catch (e) {
    console.error('[proxy] auth check failed:', e)
    // Fail closed.
    return goto('/login')
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

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
  /*
   * '/apply' without the trailing slash, so BOTH forms are public: the
   * personal link /apply/CODE, and the general enquiry at /apply that the
   * front page sends people to. With '/apply/' the bare route was not matched
   * and every visitor without somebody's referral code was redirected to a
   * staff sign-in box.
   */
  '/login', '/setup', '/apply', '/refer', '/f/', '/j/', '/signin/', '/public-alumni',
  // A member of staff's permanent marketing link. Public by design: it is
  // shared on WhatsApp, printed on cards and put behind QR codes. It exposes
  // the current promotion and the sharer's name, and nothing else — see
  // lib/marketing/link.ts for what is deliberately not selected.
  '/m/',
  // The public front page. It lives here rather than at '/', which belongs to
  // the staff portal and redirects to the sign-in.
  '/welcome',
  '/portal', '/class/',
  '/api/student/', '/api/auth/', '/api/setup/', '/api/signin/',
  '/api/classes/signin', '/api/classes/pay', '/api/fees/pay',
  '/api/webhooks/', '/api/applications/', '/api/referrals/submit',
  '/api/auth/recover/',
  '/api/courses/public', '/api/paystack/key', '/api/paystack/init', '/api/paystack/verify',
  '/api/flyers/public', '/api/flyers/submit',
  // Counts of already-public things, for the sign-in panel. Counts only —
  // see app/api/public/stats/route.ts for what it will and will not answer.
  '/api/public/stats',
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

/**
 * Shown when the session could not be VERIFIED — not when it has expired.
 *
 * Inline because middleware cannot render a React route, and because a page
 * served during a database fault must not itself need the database.
 *
 * It says what is true (we could not check, this is us, your session is
 * fine), and offers the only useful action. No sign-in link: sending somebody
 * to re-authenticate is exactly the wasted trip this replaced.
 */
const RETRY_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>One moment</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
background:#f7f7f5;color:#1a1a18}
@media(prefers-color-scheme:dark){body{background:#14140f;color:#f0efe8}}
.card{max-width:26rem;text-align:center}
h1{font-size:19px;margin:0 0 10px;font-weight:600}
p{margin:0 0 18px;opacity:.75}
button{font:inherit;font-weight:500;padding:11px 22px;border-radius:11px;border:0;
background:#1a1a18;color:#fff;cursor:pointer;min-height:44px}
@media(prefers-color-scheme:dark){button{background:#f0efe8;color:#14140f}}
</style></head><body><div class="card">
<h1>We couldn't check your sign-in</h1>
<p>This is a problem on our side, not with your account. You are still signed in — please try again in a moment.</p>
<button type="button" onclick="location.reload()">Try again</button>
</div></body></html>`

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

  /*
   * '/' is let through so the page itself can redirect to /login.
   *
   * Checked here with === rather than added to PUBLIC, and that is not
   * fussiness: '/' ends with a slash, so isMatch would evaluate it as
   * pathname.startsWith('/') — which is every route in the application. One
   * entry in that list would have made the whole product anonymous.
   *
   * Letting it pass costs nothing: the page is a redirect to /login, and
   * /login is where an unauthenticated visitor would have been sent anyway.
   */
  if (pathname === '/') return pass()

  if (isMatch(pathname, PUBLIC)) return pass()

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

    const { data, error } = await sb.from('pin_sessions')
      .select('user_id, expires_at, profiles(role, is_active, portals)')
      .eq('session_token', tokenHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    /*
     * ── A FAILED READ IS NOT AN EXPIRED SESSION ──────────────────────────────
     *
     * This error was discarded, so both outcomes fell into the branch below:
     * the one that clears the session cookie and says the session expired.
     *
     * That branch is correct for a session that is genuinely gone. For a
     * database blip it is the most destructive answer in the application,
     * because this runs on EVERY authenticated request. One bad moment signed
     * out every member of staff at once — and, because the cookie was wiped,
     * not one of them could get back by reloading. They all had to re-enter
     * their PIN, mid-task, having been told something untrue about why.
     *
     * Access still fails CLOSED: an unverifiable session is not a valid one,
     * and nobody is let through. The difference is that the session itself
     * survives, so the moment the database answers again a reload is enough.
     *
     * 503 rather than 401 for the API, because 401 is what the client treats
     * as "sign in again".
     */
    if (error) {
      console.error('[proxy] session lookup failed — refusing without clearing the session:', error.message)
      if (pathname.startsWith('/api/')) {
        return securityHeaders(NextResponse.json(
          { error: 'We could not verify your session just now. Please try again in a moment.' },
          { status: 503 },
        ), isDev)
      }
      /*
       * Deliberately NOT a redirect to /login. That page does not return a
       * still-valid session to where it came from, so sending them there
       * makes them sign in again for a fault that was never theirs — which is
       * most of the harm this fix exists to undo.
       *
       * Refusing this one request instead leaves them on the address they
       * asked for, with their session intact, so reloading is all it takes
       * once the database answers.
       */
      return securityHeaders(new NextResponse(RETRY_PAGE, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '5' },
      }), isDev)
    }

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

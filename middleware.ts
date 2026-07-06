import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { PORTAL_PATHS, ROLE_DEFAULTS, ROLE_HOME, resolvePortals } from '@/lib/access/portals'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gejtxkbatldxbbqynpfg.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlanR4a2JhdGxkeGJicXlucGZnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTExODYzOSwiZXhwIjoyMDk2Njk0NjM5fQ.FSHbZgJ2ZnzFnHl_DAM2SWwuVkXTbDmK0GQDPJCyBLs'

// Public paths — no auth needed
const PUBLIC = [
  '/certificate/',
  '/testimonial/', '/api/testimonials/',
  '/login', '/setup', '/apply/', '/refer', '/f/', '/signin/', '/public-alumni',
  '/api/auth/', '/api/setup/', '/api/signin/', '/api/classes/signin', '/api/classes/pay', '/api/fees/pay', '/api/webhooks/', '/api/applications/', '/api/referrals/', '/api/courses/public', '/api/social/', '/api/flyers/public', '/api/flyers/submit', '/_next', '/favicon',
  // PWA essentials — MUST be reachable without auth or the browser won't install the app
  '/manifest.json', '/sw.js', '/icons/', '/brand/',
]

// Portal ID → path prefixes it grants access to



export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes
  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next()
  if (pathname === '/') return NextResponse.redirect(new URL('/login', request.url))

  const token = request.cookies.get('cce_session')?.value
  if (!token) return NextResponse.redirect(new URL('/login', request.url))

  try {
    const sb = createSupabase(SUPABASE_URL, SERVICE_KEY)
    const { data } = await sb.from('pin_sessions')
      .select('user_id, expires_at, profiles(role, is_active, portals)')
      .eq('session_token', token)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!data) {
      const res = NextResponse.redirect(new URL('/login', request.url))
      res.cookies.delete('cce_session')
      return res
    }

    const profile = (data as any).profiles
    if (!profile?.is_active) {
      const res = NextResponse.redirect(new URL('/login', request.url))
      res.cookies.delete('cce_session')
      return res
    }

    const role: string = profile.role

    // Super admin — full access
    if (role === 'super_admin') return NextResponse.next()

    // Resolve this user's portals (role defaults merged with custom) from
    // the shared access module — single source of truth with the sidebar.
    const portals = resolvePortals(role, profile.portals)

    // Build allowed paths from portal list
    const allowedPaths = [
      '/api/auth', '/api/data', '/api/leads', '/api/admissions',
      '/api/reminders', '/api/attendance', '/api/finance', '/api/broadcast',
      '/api/documents', '/api/sms', '/api/test',
      '/api/staff-attendance', '/api/whatsapp', '/clock-in', '/api/analytics', '/api/activity-feed', '/api/config-status', '/api/leads', '/api/remuneration', '/api/registrations', '/api/marketer', '/api/sequences', '/api/admissions', '/api/classes', '/api/certificates', '/api/links', '/api/prep', '/api/fees', '/api/content', '/api/facebook', '/api/webhook-debug', '/api/assistant', '/api/messages', '/api/info-sessions', '/api/payment-reminders/send', '/api/payment-reminders/preview', '/finance/reminders', '/api/class-reminders', '/api/flyers', '/api/social', '/api/courses', '/api/referrals', '/api/marketer', '/api/tiers', '/api/reports', '/reports',
      ...portals.flatMap((pid: string) => PORTAL_PATHS[pid] || []),
    ]

    const isAllowed = allowedPaths.some(p => pathname === p || pathname.startsWith(p + '/'))

    if (!isAllowed) {
      // Redirect to their home portal
      const home = ROLE_HOME[role] || '/login'
      return NextResponse.redirect(new URL(home, request.url))
    }

    return NextResponse.next()
  } catch {
    // Fail closed: if anything goes wrong during auth, send to login
    // rather than letting the request through.
    const url = new URL('/login', request.url)
    return NextResponse.redirect(url)
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}

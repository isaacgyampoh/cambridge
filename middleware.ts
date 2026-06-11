import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = [
  '/login', '/apply/', '/signin/', '/public-alumni',
  '/api/auth/', '/api/webhooks/', '/_next', '/favicon'
]

const ROLE_PORTAL: Record<string, string> = {
  super_admin: '/admin',
  project_manager: '/pm',
  marketing_officer: '/marketer',
  admissions_officer: '/admission',
  accountant: '/finance',
  receptionist: '/receptionist',
  trainer: '/trainer',
  student: '/student',
}

// Which path prefixes each role can access
const ROLE_ALLOWED: Record<string, string[]> = {
  super_admin: ['/admin', '/api'],
  project_manager: ['/pm', '/api/leads', '/api/admissions', '/api/reminders', '/api/sms'],
  marketing_officer: ['/marketer', '/api/leads', '/api/reminders'],
  admissions_officer: ['/admission', '/api/admissions', '/api/documents'],
  accountant: ['/finance', '/api/finance', '/api/broadcast'],
  receptionist: ['/receptionist', '/api/reminders', '/api/attendance'],
  trainer: ['/trainer', '/api/attendance'],
  student: ['/student'],
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Allow root
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Get session cookie
  const sessionToken = request.cookies.get('cce_session')?.value

  if (!sessionToken) {
    // Not logged in — redirect to login
    const url = new URL('/login', request.url)
    if (pathname !== '/login') url.searchParams.set('from', pathname)
    return NextResponse.redirect(url)
  }

  // Verify session via internal API call
  const verifyRes = await fetch(new URL('/api/auth/me', request.url), {
    headers: { Cookie: `cce_session=${sessionToken}` },
  })

  if (!verifyRes.ok) {
    // Invalid session — clear and redirect
    const res = NextResponse.redirect(new URL('/login', request.url))
    res.cookies.delete('cce_session')
    return res
  }

  const { role, valid } = await verifyRes.json()
  if (!valid || !role) {
    const res = NextResponse.redirect(new URL('/login', request.url))
    res.cookies.delete('cce_session')
    return res
  }

  // Super admin can go anywhere
  if (role === 'super_admin') return NextResponse.next()

  // Check if accessing their own portal
  const allowedPaths = ROLE_ALLOWED[role] || []
  const isAllowed = allowedPaths.some(p => pathname.startsWith(p))

  if (!isAllowed) {
    // Wrong portal — redirect to their own
    const home = ROLE_PORTAL[role] || '/login'
    return NextResponse.redirect(new URL(home, request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}

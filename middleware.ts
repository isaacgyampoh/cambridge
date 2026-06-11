import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createSupabase } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://gejtxkbatldxbbqynpfg.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlanR4a2JhdGxkeGJicXlucGZnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTExODYzOSwiZXhwIjoyMDk2Njk0NjM5fQ.FSHbZgJ2ZnzFnHl_DAM2SWwuVkXTbDmK0GQDPJCyBLs'

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

const ROLE_ALLOWED: Record<string, string[]> = {
  super_admin: ['/admin', '/api'],
  project_manager: ['/pm', '/api'],
  marketing_officer: ['/marketer', '/api/leads', '/api/reminders', '/api/auth'],
  admissions_officer: ['/admission', '/api/admissions', '/api/documents', '/api/auth'],
  accountant: ['/finance', '/api/finance', '/api/auth'],
  receptionist: ['/receptionist', '/api/reminders', '/api/attendance', '/api/auth'],
  trainer: ['/trainer', '/api/attendance', '/api/auth'],
  student: ['/student', '/api/auth'],
}

const PUBLIC = ['/login', '/apply/', '/signin/', '/public-alumni', '/api/auth/', '/api/webhooks/', '/_next', '/favicon', '/networks/']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always allow public paths
  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next()
  if (pathname === '/') return NextResponse.redirect(new URL('/login', request.url))

  const token = request.cookies.get('cce_session')?.value
  if (!token) {
    const url = new URL('/login', request.url)
    return NextResponse.redirect(url)
  }

  // Verify session directly via Supabase (no internal fetch)
  try {
    const sb = createSupabase(SUPABASE_URL, SERVICE_KEY)
    const { data } = await sb
      .from('pin_sessions')
      .select('user_id, expires_at, profiles(role, is_active)')
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
    if (role === 'super_admin') return NextResponse.next()

    const allowed = ROLE_ALLOWED[role] || []
    const ok = allowed.some(p => pathname.startsWith(p))
    if (!ok) {
      return NextResponse.redirect(new URL(ROLE_PORTAL[role] || '/login', request.url))
    }

    return NextResponse.next()
  } catch {
    return NextResponse.next() // fail open — let page handle auth
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}

import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createSupabase } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://gejtxkbatldxbbqynpfg.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlanR4a2JhdGxkeGJicXlucGZnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTExODYzOSwiZXhwIjoyMDk2Njk0NjM5fQ.FSHbZgJ2ZnzFnHl_DAM2SWwuVkXTbDmK0GQDPJCyBLs'

// Public paths — no auth needed
const PUBLIC = [
  '/login', '/setup', '/apply/', '/signin/', '/public-alumni',
  '/api/auth/', '/api/setup/', '/api/signin/', '/api/webhooks/', '/_next', '/favicon',
]

// Portal ID → path prefixes it grants access to
const PORTAL_PATHS: Record<string, string[]> = {
  dashboard:   ['/admin', '/pm', '/marketer', '/admission', '/finance', '/receptionist', '/trainer', '/student'],
  leads:       ['/admin/leads', '/admin/pipeline'],
  my_leads:    ['/marketer'],
  pm_leads:    ['/pm'],
  admissions:  ['/admin/admissions', '/admission', '/admin/applications'],
  finance:     ['/admin/finance', '/finance'],
  broadcast:   ['/admin/broadcast'],
  attendance:  ['/admin/attendance'],
  academics:   ['/admin/academics', '/admin/courses', '/admin/classes'],
  documents:   ['/admin/documents'],
  marketers:   ['/admin/marketers'],
  alumni:      ['/admin/alumni'],
  staff:       ['/admin/staff', '/admin/reports'],
  my_classes:  ['/trainer'],
  my_payments: ['/student'],
  reminders:   ['/receptionist'],
  workforce:   ['/admin/workforce'],
  signins:     ['/admin/signins'],
  wa_lines:    ['/admin/whatsapp'],
  clock_in:    ['/clock-in'],
  settings:    ['/admin/settings'],
}

const ROLE_DEFAULTS: Record<string, string[]> = {
  super_admin:       ['dashboard','leads','admissions','finance','broadcast','attendance','academics','documents','marketers','alumni','staff','workforce','signins','wa_lines','clock_in','settings'],
  project_manager:   ['dashboard','pm_leads','leads','admissions','clock_in'],
  marketing_officer: ['dashboard','my_leads','leads','clock_in'],
  admissions_officer:['dashboard','admissions','leads','clock_in'],
  accountant:        ['dashboard','finance','leads','clock_in'],
  receptionist:      ['dashboard','reminders','attendance','clock_in'],
  trainer:           ['dashboard','my_classes','attendance','clock_in'],
  student:           ['dashboard','my_payments'],
}

const ROLE_HOME: Record<string, string> = {
  super_admin:'/admin', project_manager:'/pm', marketing_officer:'/marketer',
  admissions_officer:'/admission', accountant:'/finance', receptionist:'/receptionist',
  trainer:'/trainer', student:'/student',
}

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

    // Get this user's portal list (custom or role default)
    const portals: string[] = profile.portals?.length
      ? profile.portals
      : ROLE_DEFAULTS[role] || ['dashboard']

    // Build allowed paths from portal list
    const allowedPaths = [
      '/api/auth', '/api/data', '/api/leads', '/api/admissions',
      '/api/reminders', '/api/attendance', '/api/finance', '/api/broadcast',
      '/api/documents', '/api/sms', '/api/test',
      '/api/staff-attendance', '/api/whatsapp', '/clock-in',
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
    return NextResponse.next()
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}

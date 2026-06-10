import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const ROLE_REDIRECTS: Record<string, string> = {
  super_admin: '/admin',
  project_manager: '/pm',
  marketing_officer: '/marketer',
  admissions_officer: '/admission',
  accountant: '/finance',
  receptionist: '/receptionist',
  trainer: '/trainer',
  student: '/student',
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // Public routes
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/apply') ||
    pathname.startsWith('/api/webhooks') ||
    pathname === '/'
  ) {
    if (user && pathname === '/login') {
      // Redirect logged in users away from login
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      const dest = profile ? ROLE_REDIRECTS[profile.role] || '/login' : '/login'
      return NextResponse.redirect(new URL(dest, request.url))
    }
    return supabaseResponse
  }

  // Protected routes — require auth
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Role-based access control
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=inactive', request.url))
  }

  const allowedBase = ROLE_REDIRECTS[profile.role]

  // Super admin can access everything
  if (profile.role === 'super_admin') return supabaseResponse

  // Check if user is accessing their allowed portal
  if (allowedBase && !pathname.startsWith(allowedBase)) {
    return NextResponse.redirect(new URL(allowedBase, request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}

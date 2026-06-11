'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'
import {
  LayoutDashboard, Users, UserCheck, DollarSign, BookOpen,
  Bell, LogOut, Menu, X, GraduationCap, TrendingUp,
  ClipboardList, Settings, Building2, ChevronRight,
  Kanban, Radio, CalendarCheck, FolderOpen, BarChart3,
  Shield, ArrowLeft
} from 'lucide-react'

/* ── Navigation config ─────────────────────────────────────── */
const NAV: Record<string, { label: string; href: string; icon: any }[]> = {
  super_admin: [
    { label: 'Dashboard',     href: '/admin',              icon: LayoutDashboard },
    { label: 'Lead Pipeline', href: '/admin/pipeline',     icon: Kanban },
    { label: 'All Leads',     href: '/admin/leads',        icon: TrendingUp },
    { label: 'Admissions',    href: '/admin/admissions',   icon: UserCheck },
    { label: 'Finance',       href: '/admin/finance',      icon: DollarSign },
    { label: 'Broadcast',     href: '/admin/broadcast',    icon: Radio },
    { label: 'Attendance',    href: '/admin/attendance',   icon: CalendarCheck },
    { label: 'Courses',       href: '/admin/courses',      icon: BookOpen },
    { label: 'Classes',       href: '/admin/classes',      icon: GraduationCap },
    { label: 'Documents',     href: '/admin/documents',    icon: FolderOpen },
    { label: 'Marketers',     href: '/admin/marketers',    icon: BarChart3 },
    { label: 'Alumni',        href: '/admin/alumni',       icon: GraduationCap },
    { label: 'Staff',         href: '/admin/staff',        icon: Users },
    { label: 'Reports',       href: '/admin/reports',      icon: ClipboardList },
    { label: 'Settings',      href: '/admin/settings',     icon: Settings },
  ],
  project_manager: [
    { label: 'Dashboard',   href: '/pm',          icon: LayoutDashboard },
    { label: 'Lead Inbox',  href: '/pm',          icon: TrendingUp },
    { label: 'Reports',     href: '/pm/reports',  icon: ClipboardList },
  ],
  marketing_officer: [
    { label: 'Dashboard',   href: '/marketer',            icon: LayoutDashboard },
    { label: 'My Leads',    href: '/marketer',            icon: TrendingUp },
    { label: 'Follow-ups',  href: '/marketer/activities', icon: Bell },
    { label: 'My Link',     href: '/marketer/link',       icon: Users },
  ],
  admissions_officer: [
    { label: 'Dashboard',   href: '/admission', icon: LayoutDashboard },
    { label: 'Admissions',  href: '/admission', icon: UserCheck },
  ],
  accountant: [
    { label: 'Dashboard', href: '/finance',             icon: LayoutDashboard },
    { label: 'Payments',  href: '/finance',             icon: DollarSign },
    { label: 'Reports',   href: '/finance/reports',     icon: ClipboardList },
  ],
  receptionist: [
    { label: 'Dashboard', href: '/receptionist', icon: LayoutDashboard },
  ],
  trainer: [
    { label: 'Dashboard', href: '/trainer', icon: LayoutDashboard },
  ],
  student: [
    { label: 'Dashboard', href: '/student',          icon: LayoutDashboard },
    { label: 'Payments',  href: '/student/payments', icon: DollarSign },
  ],
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin', project_manager: 'Project Manager',
  marketing_officer: 'Marketing Officer', admissions_officer: 'Admissions Officer',
  accountant: 'Accountant', receptionist: 'Receptionist',
  trainer: 'Trainer', student: 'Student',
}

const ROLE_COLOR: Record<string, string> = {
  super_admin: 'bg-purple-600', project_manager: 'bg-blue-600',
  marketing_officer: 'bg-green-600', admissions_officer: 'bg-indigo-600',
  accountant: 'bg-amber-600', receptionist: 'bg-pink-600',
  trainer: 'bg-orange-600', student: 'bg-gray-500',
}

/* ── Sidebar widths ────────────────────────────────────────── */
const SIDEBAR_W   = 240   // px — expanded
const SIDEBAR_COL = 64    // px — icon-only collapsed (desktop)

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()

  const [profile,     setProfile]     = useState<Profile | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [mobileOpen,  setMobileOpen]  = useState(false)   // mobile drawer
  const [collapsed,   setCollapsed]   = useState(false)   // desktop icon-only mode
  const [unread,      setUnread]      = useState(0)
  const sb = createClient()

  /* load session */
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (!s?.valid) { router.replace('/login'); return }
        sb.from('profiles').select('*').eq('id', s.userId).single()
          .then(({ data }) => { setProfile(data); setLoading(false) })
      })
      .catch(() => router.replace('/login'))
  }, [])

  /* realtime notification count */
  useEffect(() => {
    if (!profile) return
    sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id).eq('is_read', false)
      .then(({ count }) => setUnread(count || 0))
    const ch = sb.channel(`notif-${profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        () => setUnread(n => n + 1))
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [profile?.id])

  /* close mobile drawer on route change */
  useEffect(() => { setMobileOpen(false) }, [pathname])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  /* breadcrumb back: go up one level */
  function goBack() { router.back() }

  const canGoBack = pathname.split('/').filter(Boolean).length > 1

  if (loading) return (
    <div className="min-h-screen w-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    </div>
  )

  const navItems  = profile ? NAV[profile.role] || [] : []
  const roleColor = ROLE_COLOR[profile?.role || ''] || 'bg-blue-600'
  const sideW     = collapsed ? SIDEBAR_COL : SIDEBAR_W

  /* ── Sidebar inner content ─────────────────────────────────── */
  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
    <div className="flex flex-col h-full">

      {/* Brand row */}
      <div
        className="flex items-center gap-3 border-b border-slate-800 flex-shrink-0"
        style={{ height: 60, paddingLeft: 16, paddingRight: 12 }}
      >
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
          <Building2 size={16} className="text-white" />
        </div>
        {(!collapsed || mobile) && (
          <div className="flex-1 min-w-0">
            <div className="text-white text-xs font-bold truncate">Cambridge CE</div>
            <div className="text-blue-400 text-[10px] truncate">{ROLE_LABEL[profile?.role || ''] || ''}</div>
          </div>
        )}
        {/* Close btn on mobile */}
        {mobile && (
          <button onClick={() => setMobileOpen(false)}
            className="ml-auto text-slate-500 hover:text-white p-1 transition-colors">
            <X size={18} />
          </button>
        )}
        {/* Collapse toggle on desktop */}
        {!mobile && (
          <button onClick={() => setCollapsed(c => !c)}
            className="ml-auto text-slate-500 hover:text-white p-1 transition-colors"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <Menu size={16} />
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {navItems.map(item => {
          const Icon   = item.icon
          const active = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href + '/') && item.href.split('/').length > 1)

          return (
            <Link key={item.label + item.href} href={item.href}
              title={collapsed && !mobile ? item.label : undefined}
              className={`flex items-center gap-3 rounded-xl transition-all duration-100 group
                ${collapsed && !mobile ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
                ${active
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/40'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              <Icon size={18} className="flex-shrink-0" />
              {(!collapsed || mobile) && (
                <span className="text-[13px] font-medium truncate flex-1">{item.label}</span>
              )}
              {(!collapsed || mobile) && active && (
                <ChevronRight size={13} className="opacity-50 flex-shrink-0" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Profile footer */}
      <div className="border-t border-slate-800 p-3 flex-shrink-0 space-y-1">
        {(!collapsed || mobile) ? (
          <>
            <div className="flex items-center gap-2.5 px-1 py-1">
              <div className={`w-8 h-8 rounded-full ${roleColor} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                {profile?.full_name?.charAt(0) || '?'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-white text-[13px] font-semibold truncate leading-tight">{profile?.full_name}</div>
                <div className="text-slate-500 text-[10px] truncate">{profile?.email}</div>
              </div>
            </div>
            <div className="flex gap-1.5">
              <Link href="/admin/settings/change-pin"
                className="flex-1 flex items-center justify-center gap-1 py-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg text-[11px] transition-colors">
                <Shield size={11} /> PIN
              </Link>
              <button onClick={logout}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg text-[11px] transition-colors">
                <LogOut size={11} /> Logout
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className={`w-8 h-8 rounded-full ${roleColor} flex items-center justify-center text-white text-xs font-bold`}>
              {profile?.full_name?.charAt(0) || '?'}
            </div>
            <button onClick={logout} title="Logout"
              className="text-slate-500 hover:text-red-400 p-1.5 hover:bg-slate-800 rounded-lg transition-colors">
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )

  /* ── Page title from pathname ─────────────────────────────── */
  const segments = pathname.split('/').filter(Boolean)
  const pageTitle = segments[segments.length - 1]?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Dashboard'

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50">

      {/* ── Desktop sidebar ─────────────────────────────────────── */}
      <aside
        className="hidden lg:flex flex-col bg-slate-900 flex-shrink-0 transition-all duration-200 ease-in-out"
        style={{ width: sideW }}>
        <SidebarContent />
      </aside>

      {/* ── Mobile drawer overlay ────────────────────────────────── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)} />
          {/* drawer */}
          <div className="relative z-10 flex flex-col bg-slate-900 h-full shadow-2xl"
            style={{ width: SIDEBAR_W }}>
            <SidebarContent mobile />
          </div>
        </div>
      )}

      {/* ── Main area ───────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Topbar */}
        <header className="flex-shrink-0 bg-white border-b border-gray-200 flex items-center gap-3 px-4 lg:px-6"
          style={{ height: 60 }}>

          {/* Mobile hamburger */}
          <button onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors -ml-1">
            <Menu size={20} />
          </button>

          {/* Back button — shown when not on root page */}
          {canGoBack && (
            <button onClick={goBack}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 px-3 py-1.5 rounded-xl transition-colors">
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Back</span>
            </button>
          )}

          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-sm min-w-0 flex-1">
            {segments.map((seg, i) => {
              const href = '/' + segments.slice(0, i + 1).join('/')
              const isLast = i === segments.length - 1
              const label = seg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
              return (
                <span key={href} className="flex items-center gap-1.5 min-w-0">
                  {i > 0 && <ChevronRight size={13} className="text-gray-300 flex-shrink-0" />}
                  {isLast
                    ? <span className="font-semibold text-gray-900 truncate">{label}</span>
                    : <Link href={href} className="text-gray-400 hover:text-gray-700 transition-colors truncate">{label}</Link>}
                </span>
              )
            })}
          </div>

          {/* Right: notifications + avatar */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button className="relative p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors">
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>

            <div className="flex items-center gap-2 pl-2 border-l border-gray-100">
              <div className={`w-8 h-8 rounded-full ${roleColor} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                {profile?.full_name?.charAt(0) || '?'}
              </div>
              <div className="hidden md:block">
                <div className="text-sm font-semibold text-gray-900 leading-tight">{profile?.full_name?.split(' ')[0]}</div>
                <div className="text-[10px] text-gray-400">{ROLE_LABEL[profile?.role || '']}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Page content — fills ALL remaining space */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="w-full h-full p-4 lg:p-6 xl:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

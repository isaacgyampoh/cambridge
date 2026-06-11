'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'
import {
  LayoutDashboard, Users, UserCheck, DollarSign, BookOpen,
  Bell, LogOut, Menu, X, GraduationCap, TrendingUp,
  ClipboardList, Settings, Building2, ChevronRight,
  Kanban, Radio, CalendarCheck, FolderOpen, BarChart3,
  Shield, ArrowLeft, ChevronDown, ChevronUp, UserPlus
} from 'lucide-react'

/* ── Nav groups with optional sub-items ─────────────────────── */
type NavItem = {
  label: string
  href: string
  icon: any
  children?: { label: string; href: string }[]
}

const NAV: Record<string, NavItem[]> = {
  super_admin: [
    { label: 'Dashboard',     href: '/admin',            icon: LayoutDashboard },
    {
      label: 'CRM',           href: '/admin/leads',      icon: TrendingUp,
      children: [
        { label: 'All Leads',     href: '/admin/leads' },
        { label: 'Lead Pipeline', href: '/admin/pipeline' },
        { label: 'Add Lead',      href: '/admin/leads/new' },
        { label: 'Import Leads',  href: '/admin/leads/import' },
      ],
    },
    {
      label: 'Admissions',    href: '/admin/admissions', icon: UserCheck,
      children: [
        { label: 'All Admissions', href: '/admin/admissions' },
        { label: 'Applications',   href: '/admin/applications' },
      ],
    },
    {
      label: 'Finance',       href: '/admin/finance',    icon: DollarSign,
      children: [
        { label: 'Payments',  href: '/admin/finance' },
        { label: 'Invoices',  href: '/finance/invoices/new' },
        { label: 'Reports',   href: '/finance/reports' },
      ],
    },
    { label: 'Broadcast',     href: '/admin/broadcast',  icon: Radio },
    { label: 'Attendance',    href: '/admin/attendance', icon: CalendarCheck },
    {
      label: 'Academics',     href: '/admin/courses',    icon: BookOpen,
      children: [
        { label: 'Courses',  href: '/admin/courses' },
        { label: 'Classes',  href: '/admin/classes' },
      ],
    },
    { label: 'Documents',     href: '/admin/documents',  icon: FolderOpen },
    { label: 'Marketers',     href: '/admin/marketers',  icon: BarChart3 },
    { label: 'Alumni',        href: '/admin/alumni',     icon: GraduationCap },
    {
      label: 'Staff',         href: '/admin/staff',      icon: Users,
      children: [
        { label: 'All Staff',  href: '/admin/staff' },
        { label: 'Reports',    href: '/admin/reports' },
      ],
    },
    { label: 'Settings',      href: '/admin/settings',   icon: Settings },
  ],
  project_manager: [
    { label: 'Dashboard',  href: '/pm',           icon: LayoutDashboard },
    {
      label: 'Leads',      href: '/pm',            icon: TrendingUp,
      children: [
        { label: 'Lead Inbox',  href: '/pm' },
        { label: 'Add Lead',    href: '/admin/leads/new' },
        { label: 'Import',      href: '/admin/leads/import' },
      ],
    },
    { label: 'Reports',    href: '/pm/reports',    icon: ClipboardList },
  ],
  marketing_officer: [
    { label: 'Dashboard',   href: '/marketer',             icon: LayoutDashboard },
    { label: 'My Leads',    href: '/marketer',             icon: TrendingUp },
    { label: 'Follow-ups',  href: '/marketer/activities',  icon: Bell },
    { label: 'My Link',     href: '/marketer/link',        icon: UserPlus },
  ],
  admissions_officer: [
    { label: 'Dashboard',   href: '/admission', icon: LayoutDashboard },
    { label: 'Admissions',  href: '/admission', icon: UserCheck },
  ],
  accountant: [
    { label: 'Dashboard', href: '/finance',         icon: LayoutDashboard },
    { label: 'Payments',  href: '/finance',         icon: DollarSign },
    { label: 'Reports',   href: '/finance/reports', icon: ClipboardList },
  ],
  receptionist: [
    { label: 'Dashboard', href: '/receptionist', icon: LayoutDashboard },
  ],
  trainer: [
    { label: 'Dashboard', href: '/trainer', icon: LayoutDashboard },
  ],
  student: [
    { label: 'Dashboard', href: '/student',         icon: LayoutDashboard },
    { label: 'Payments',  href: '/student/payments', icon: DollarSign },
  ],
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',          project_manager: 'Project Manager',
  marketing_officer: 'Marketing',      admissions_officer: 'Admissions',
  accountant: 'Accountant',           receptionist: 'Receptionist',
  trainer: 'Trainer',                  student: 'Student',
}

const ROLE_COLOR: Record<string, string> = {
  super_admin: 'bg-purple-600',        project_manager: 'bg-blue-600',
  marketing_officer: 'bg-green-600',   admissions_officer: 'bg-indigo-600',
  accountant: 'bg-amber-600',          receptionist: 'bg-pink-600',
  trainer: 'bg-orange-600',            student: 'bg-gray-500',
}

const COLLAPSED_W = 64
const EXPANDED_W  = 240

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()

  const [profile,      setProfile]      = useState<Profile | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [mobileOpen,   setMobileOpen]   = useState(false)
  const [collapsed,    setCollapsed]    = useState(false)
  const [hovered,      setHovered]      = useState(false)   // hover-to-expand
  const [openGroups,   setOpenGroups]   = useState<string[]>([])
  const [unread,       setUnread]       = useState(0)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sb = createClient()

  const isExpanded = !collapsed || hovered || mobileOpen

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

  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Auto-open group containing current path
  useEffect(() => {
    const navItems = profile ? NAV[profile.role] || [] : []
    navItems.forEach(item => {
      if (item.children?.some(c => pathname.startsWith(c.href))) {
        setOpenGroups(g => g.includes(item.label) ? g : [...g, item.label])
      }
    })
  }, [pathname, profile?.role])

  function toggleGroup(label: string) {
    setOpenGroups(g => g.includes(label) ? g.filter(x => x !== label) : [...g, label])
  }

  function handleMouseEnter() {
    if (!collapsed) return
    hoverTimer.current = setTimeout(() => setHovered(true), 80)
  }

  function handleMouseLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHovered(false)
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  const canGoBack  = pathname.split('/').filter(Boolean).length > 1
  const navItems   = profile ? NAV[profile.role] || [] : []
  const roleColor  = ROLE_COLOR[profile?.role || ''] || 'bg-blue-600'
  const sideWidth  = isExpanded ? EXPANDED_W : COLLAPSED_W

  if (loading) return (
    <div className="min-h-screen w-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    </div>
  )

  /* ── Nav item renderer ─────────────────────────────────────── */
  const NavRow = ({ item, mobile = false }: { item: NavItem; mobile?: boolean }) => {
    const exp   = mobile || isExpanded
    const Icon  = item.icon
    const hasKids = !!item.children?.length
    const isOpen  = openGroups.includes(item.label)

    // Is this group or any child active?
    const selfActive  = pathname === item.href
    const childActive = item.children?.some(c => pathname === c.href || pathname.startsWith(c.href + '/'))
    const active      = selfActive || (!hasKids && pathname.startsWith(item.href + '/'))
    const groupActive = childActive

    if (hasKids) {
      return (
        <div>
          <button
            onClick={() => exp ? toggleGroup(item.label) : null}
            title={!exp ? item.label : undefined}
            className={`w-full flex items-center rounded-xl transition-all duration-100
              ${exp ? 'gap-2.5 px-3 py-2.5' : 'justify-center px-0 py-2.5'}
              ${groupActive
                ? 'bg-blue-600/20 text-blue-300'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
            <Icon size={18} className="flex-shrink-0" />
            {exp && (
              <>
                <span className="text-[13px] font-medium flex-1 text-left truncate">{item.label}</span>
                {isOpen ? <ChevronUp size={13} className="opacity-50" /> : <ChevronDown size={13} className="opacity-50" />}
              </>
            )}
          </button>

          {/* Sub-items */}
          {exp && isOpen && (
            <div className="ml-3 mt-0.5 pl-3 border-l border-slate-700 space-y-0.5 mb-1">
              {item.children!.map(child => {
                const ca = pathname === child.href || pathname.startsWith(child.href + '/')
                return (
                  <Link key={child.href} href={child.href}
                    className={`flex items-center px-3 py-2 rounded-xl text-[12px] font-medium transition-all
                      ${ca ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    {child.label}
                    {ca && <ChevronRight size={11} className="ml-auto opacity-50" />}
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    return (
      <Link href={item.href}
        title={!exp ? item.label : undefined}
        className={`flex items-center rounded-xl transition-all duration-100
          ${exp ? 'gap-2.5 px-3 py-2.5' : 'justify-center px-0 py-2.5'}
          ${active
            ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/40'
            : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
        <Icon size={18} className="flex-shrink-0" />
        {exp && <span className="text-[13px] font-medium truncate flex-1">{item.label}</span>}
        {exp && active && <ChevronRight size={13} className="opacity-50 flex-shrink-0" />}
      </Link>
    )
  }

  /* ── Sidebar inner ─────────────────────────────────────────── */
  const SidebarInner = ({ mobile = false }: { mobile?: boolean }) => {
    const exp = mobile || isExpanded
    return (
      <div className="flex flex-col h-full">
        {/* Brand */}
        <div className="flex items-center border-b border-slate-800 flex-shrink-0 px-3"
          style={{ height: 60 }}>
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <Building2 size={16} className="text-white" />
          </div>
          {exp && (
            <div className="ml-3 flex-1 min-w-0">
              <div className="text-white text-[13px] font-bold truncate leading-tight">Cambridge CE</div>
              <div className="text-blue-400 text-[10px] truncate">{ROLE_LABEL[profile?.role || ''] || ''}</div>
            </div>
          )}
          {mobile ? (
            <button onClick={() => setMobileOpen(false)}
              className="ml-auto text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors">
              <X size={16} />
            </button>
          ) : (
            <button
              onClick={() => { setCollapsed(c => !c); setHovered(false) }}
              className={`${exp ? 'ml-auto' : 'hidden'} text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors`}
              title={collapsed ? 'Expand' : 'Collapse'}>
              <Menu size={16} />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {navItems.map(item => (
            <NavRow key={item.label} item={item} mobile={mobile} />
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-800 p-2.5 flex-shrink-0">
          {exp ? (
            <>
              <div className="flex items-center gap-2.5 px-2 py-1.5 mb-1.5">
                <div className={`w-8 h-8 rounded-full ${roleColor} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                  {profile?.full_name?.charAt(0) || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-white text-[12px] font-semibold truncate">{profile?.full_name}</div>
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
                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors">
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const segments  = pathname.split('/').filter(Boolean)
  const pageTitle = segments[segments.length - 1]
    ?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Dashboard'

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50">

      {/* ── Desktop sidebar with hover-expand ─────────────────── */}
      <aside
        className="hidden lg:flex flex-col bg-slate-900 flex-shrink-0 relative z-20"
        style={{
          width: sideWidth,
          transition: 'width 0.18s ease',
          overflow: isExpanded ? 'visible' : 'hidden',
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}>
        {/* When collapsed + hovered, float the expanded panel */}
        {collapsed && hovered ? (
          <div className="absolute top-0 left-0 h-full bg-slate-900 shadow-2xl z-50"
            style={{ width: EXPANDED_W }}>
            <SidebarInner />
          </div>
        ) : (
          <SidebarInner />
        )}
      </aside>

      {/* ── Mobile drawer ──────────────────────────────────────── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 h-full bg-slate-900 shadow-2xl flex flex-col"
            style={{ width: EXPANDED_W }}>
            <SidebarInner mobile />
          </div>
        </div>
      )}

      {/* ── Main ────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Topbar */}
        <header className="flex-shrink-0 bg-white border-b border-gray-200 flex items-center gap-2 px-4 lg:px-5"
          style={{ height: 60 }}>

          <button onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors -ml-1">
            <Menu size={20} />
          </button>

          {/* Back button */}
          {canGoBack && (
            <button onClick={() => router.back()}
              className="flex items-center gap-1.5 h-8 px-3 text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors">
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Back</span>
            </button>
          )}

          {/* Breadcrumb */}
          <div className="flex items-center gap-1 text-sm min-w-0 flex-1 overflow-hidden">
            {segments.map((seg, i) => {
              const href  = '/' + segments.slice(0, i + 1).join('/')
              const isLast = i === segments.length - 1
              const label  = seg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
              return (
                <span key={href} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <ChevronRight size={12} className="text-gray-300 flex-shrink-0" />}
                  {isLast
                    ? <span className="font-semibold text-gray-900 truncate">{label}</span>
                    : <Link href={href} className="text-gray-400 hover:text-gray-700 truncate transition-colors hidden sm:block">{label}</Link>}
                </span>
              )
            })}
          </div>

          {/* Right */}
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
              <div className="hidden md:block leading-tight">
                <div className="text-sm font-semibold text-gray-900">{profile?.full_name?.split(' ')[0]}</div>
                <div className="text-[10px] text-gray-400">{ROLE_LABEL[profile?.role || '']}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="w-full p-4 lg:p-6 xl:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

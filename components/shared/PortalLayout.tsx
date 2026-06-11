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
  Shield, ArrowLeft, ChevronDown, ChevronUp, UserPlus,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react'

type NavChild = { label: string; href: string }
type NavItem  = { label: string; href: string; icon: any; children?: NavChild[] }

const NAV: Record<string, NavItem[]> = {
  super_admin: [
    { label: 'Dashboard',   href: '/admin',           icon: LayoutDashboard },
    { label: 'CRM',         href: '/admin/leads',     icon: TrendingUp,
      children: [
        { label: 'All Leads',     href: '/admin/leads' },
        { label: 'Lead Pipeline', href: '/admin/pipeline' },
        { label: 'Add Lead',      href: '/admin/leads/new' },
        { label: 'Import Leads',  href: '/admin/leads/import' },
      ]},
    { label: 'Admissions',  href: '/admin/admissions', icon: UserCheck,
      children: [
        { label: 'All Admissions', href: '/admin/admissions' },
        { label: 'Applications',   href: '/admin/applications' },
      ]},
    { label: 'Finance',     href: '/admin/finance',   icon: DollarSign,
      children: [
        { label: 'Payments', href: '/admin/finance' },
        { label: 'Invoices', href: '/finance/invoices/new' },
        { label: 'Reports',  href: '/finance/reports' },
      ]},
    { label: 'Broadcast',   href: '/admin/broadcast',  icon: Radio },
    { label: 'Attendance',  href: '/admin/attendance', icon: CalendarCheck },
    { label: 'Academics',   href: '/admin/courses',   icon: BookOpen,
      children: [
        { label: 'Courses', href: '/admin/courses' },
        { label: 'Classes', href: '/admin/classes' },
      ]},
    { label: 'Documents',   href: '/admin/documents', icon: FolderOpen },
    { label: 'Marketers',   href: '/admin/marketers', icon: BarChart3 },
    { label: 'Alumni',      href: '/admin/alumni',    icon: GraduationCap },
    { label: 'Staff',       href: '/admin/staff',     icon: Users,
      children: [
        { label: 'All Staff', href: '/admin/staff' },
        { label: 'Reports',   href: '/admin/reports' },
      ]},
    { label: 'Settings',    href: '/admin/settings',  icon: Settings },
  ],
  project_manager: [
    { label: 'Dashboard', href: '/pm',         icon: LayoutDashboard },
    { label: 'Leads',     href: '/pm',         icon: TrendingUp,
      children: [
        { label: 'Lead Inbox', href: '/pm' },
        { label: 'Add Lead',   href: '/admin/leads/new' },
        { label: 'Import',     href: '/admin/leads/import' },
      ]},
    { label: 'Reports',   href: '/pm/reports', icon: ClipboardList },
  ],
  marketing_officer: [
    { label: 'Dashboard',  href: '/marketer',            icon: LayoutDashboard },
    { label: 'My Leads',   href: '/marketer',            icon: TrendingUp },
    { label: 'Follow-ups', href: '/marketer/activities', icon: Bell },
    { label: 'My Link',    href: '/marketer/link',       icon: UserPlus },
  ],
  admissions_officer: [
    { label: 'Dashboard',  href: '/admission', icon: LayoutDashboard },
    { label: 'Admissions', href: '/admission', icon: UserCheck },
  ],
  accountant: [
    { label: 'Dashboard', href: '/finance',         icon: LayoutDashboard },
    { label: 'Payments',  href: '/finance',         icon: DollarSign },
    { label: 'Reports',   href: '/finance/reports', icon: ClipboardList },
  ],
  receptionist: [{ label: 'Dashboard', href: '/receptionist', icon: LayoutDashboard }],
  trainer:      [{ label: 'Dashboard', href: '/trainer',      icon: LayoutDashboard }],
  student: [
    { label: 'Dashboard', href: '/student',          icon: LayoutDashboard },
    { label: 'Payments',  href: '/student/payments', icon: DollarSign },
  ],
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',         project_manager: 'Project Manager',
  marketing_officer: 'Marketing',     admissions_officer: 'Admissions',
  accountant: 'Accountant',           receptionist: 'Receptionist',
  trainer: 'Trainer',                 student: 'Student',
}

const ROLE_COLOR: Record<string, string> = {
  super_admin: 'bg-purple-600',       project_manager: 'bg-blue-600',
  marketing_officer: 'bg-green-600',  admissions_officer: 'bg-indigo-600',
  accountant: 'bg-amber-600',         receptionist: 'bg-pink-600',
  trainer: 'bg-orange-600',           student: 'bg-gray-500',
}

const W_FULL = 248
const W_ICON = 60

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const sb       = createClient()

  const [profile,     setProfile]     = useState<Profile | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [pinned,      setPinned]      = useState(true)   // true = expanded, false = icon-only
  const [hovered,     setHovered]     = useState(false)  // hover-expand when pinned=false
  const [mobileOpen,  setMobileOpen]  = useState(false)
  const [openGroups,  setOpenGroups]  = useState<Set<string>>(new Set())
  const [unread,      setUnread]      = useState(0)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const expanded = pinned || hovered   // sidebar shows labels when true

  /* ── Bootstrap ──────────────────────────────────────────────── */
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
    const ch = sb.channel(`n-${profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        () => setUnread(n => n + 1))
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [profile?.id])

  /* ── Auto-open group for current path ───────────────────────── */
  useEffect(() => {
    if (!profile) return
    const items = NAV[profile.role] || []
    items.forEach(item => {
      if (item.children?.some(c => pathname === c.href || pathname.startsWith(c.href + '/'))) {
        setOpenGroups(s => { const n = new Set(s); n.add(item.label); return n })
      }
    })
  }, [pathname, profile?.role])

  /* ── Close mobile on navigate ───────────────────────────────── */
  useEffect(() => { setMobileOpen(false) }, [pathname])

  function toggleGroup(label: string) {
    setOpenGroups(s => {
      const n = new Set(s)
      n.has(label) ? n.delete(label) : n.add(label)
      return n
    })
  }

  function onMouseEnter() {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    if (!pinned) setHovered(true)
  }

  function onMouseLeave() {
    leaveTimer.current = setTimeout(() => setHovered(false), 120) as any
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  if (loading) return (
    <div className="fixed inset-0 bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 text-sm">Loading your workspace…</p>
      </div>
    </div>
  )

  const navItems  = profile ? NAV[profile.role] || [] : []
  const roleColor = ROLE_COLOR[profile?.role || ''] || 'bg-blue-600'
  const segments  = pathname.split('/').filter(Boolean)
  const canGoBack = segments.length > 1

  /* ── Single nav row ─────────────────────────────────────────── */
  const NavRow = ({ item, isMobile }: { item: NavItem; isMobile?: boolean }) => {
    const show    = isMobile || expanded
    const Icon    = item.icon
    const isGroup = !!item.children?.length
    const isOpen  = openGroups.has(item.label)

    // active detection
    const selfActive  = pathname === item.href
    const childActive = item.children?.some(c => pathname === c.href || (c.href.length > 1 && pathname.startsWith(c.href + '/')))
    const active      = !isGroup && (selfActive || (item.href.length > 1 && pathname.startsWith(item.href + '/')))
    const groupLit    = isGroup && childActive

    const baseRow = `
      flex items-center w-full rounded-xl transition-colors duration-100 select-none
      ${show ? 'gap-3 px-3 py-2.5' : 'justify-center p-3'}
    `

    if (isGroup) {
      return (
        <div>
          <button
            onClick={() => show && toggleGroup(item.label)}
            title={!show ? item.label : undefined}
            className={`${baseRow} ${groupLit ? 'bg-blue-600/15 text-blue-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
            <Icon size={18} className="flex-shrink-0" />
            {show && <>
              <span className="flex-1 text-left text-[13px] font-medium truncate">{item.label}</span>
              {isOpen ? <ChevronUp size={13} className="opacity-40" /> : <ChevronDown size={13} className="opacity-40" />}
            </>}
          </button>
          {show && isOpen && (
            <div className="ml-2 mt-0.5 pl-4 border-l border-slate-700 space-y-0.5 mb-1">
              {item.children!.map(child => {
                const ca = pathname === child.href || (child.href.length > 1 && pathname.startsWith(child.href + '/'))
                return (
                  <Link key={child.href} href={child.href}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl text-[12px] font-medium transition-colors
                      ${ca ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    {child.label}
                    {ca && <ChevronRight size={11} className="opacity-50" />}
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
        title={!show ? item.label : undefined}
        className={`${baseRow} ${active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
        <Icon size={18} className="flex-shrink-0" />
        {show && <>
          <span className="flex-1 text-[13px] font-medium truncate">{item.label}</span>
          {active && <ChevronRight size={13} className="opacity-50" />}
        </>}
      </Link>
    )
  }

  /* ── Sidebar body ───────────────────────────────────────────── */
  const SidebarBody = ({ isMobile = false }: { isMobile?: boolean }) => {
    const show = isMobile || expanded
    return (
      <div className="flex flex-col h-full bg-slate-900">
        {/* Brand */}
        <div className={`flex items-center border-b border-slate-800 flex-shrink-0 ${show ? 'px-4 gap-3' : 'justify-center px-2'}`}
          style={{ height: 60 }}>
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <Building2 size={15} className="text-white" />
          </div>
          {show && (
            <div className="flex-1 min-w-0">
              <div className="text-white text-[13px] font-bold leading-tight truncate">Cambridge CE</div>
              <div className="text-blue-400 text-[10px] truncate">{ROLE_LABEL[profile?.role || ''] || ''}</div>
            </div>
          )}
          {isMobile ? (
            <button onClick={() => setMobileOpen(false)}
              className="ml-auto p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
              <X size={16} />
            </button>
          ) : show && (
            <button onClick={() => { setPinned(false); setHovered(false) }}
              title="Collapse sidebar"
              className="ml-auto p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {navItems.map(item => <NavRow key={item.label} item={item} isMobile={isMobile} />)}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-800 p-2.5 flex-shrink-0">
          {show ? (
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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50">

      {/* ── Desktop sidebar ────────────────────────────────────────────── */}
      <div
        className="hidden lg:block relative flex-shrink-0 bg-slate-900 z-30"
        style={{ width: expanded ? W_FULL : W_ICON, transition: 'width 0.2s ease' }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}>

        {/* When icon-only + hovering, float the full panel on top */}
        {!pinned && hovered ? (
          <div className="absolute inset-y-0 left-0 z-50 shadow-2xl" style={{ width: W_FULL }}>
            <SidebarBody />
          </div>
        ) : (
          <div className="h-full" style={{ width: expanded ? W_FULL : W_ICON }}>
            <SidebarBody />
          </div>
        )}

        {/* Expand button shown when fully collapsed + not hovering */}
        {!pinned && !hovered && (
          <button
            onClick={() => setPinned(true)}
            title="Expand sidebar"
            className="absolute bottom-16 left-1/2 -translate-x-1/2 p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
            <PanelLeftOpen size={16} />
          </button>
        )}
      </div>

      {/* ── Mobile drawer ──────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 shadow-2xl" style={{ width: W_FULL }}>
            <SidebarBody isMobile />
          </div>
        </div>
      )}

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Topbar */}
        <header className="flex-shrink-0 bg-white border-b border-gray-200 flex items-center gap-2 px-4 lg:px-5"
          style={{ height: 60 }}>

          {/* Mobile hamburger */}
          <button onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors -ml-1">
            <Menu size={20} />
          </button>

          {/* Back */}
          {canGoBack && (
            <button onClick={() => router.back()}
              className="flex items-center gap-1.5 h-8 px-3 text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors">
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Back</span>
            </button>
          )}

          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm min-w-0 flex-1 overflow-hidden">
            {segments.map((seg, i) => {
              const href   = '/' + segments.slice(0, i + 1).join('/')
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
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button className="relative p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors">
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[14px] h-3.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            <div className="flex items-center gap-2 pl-2 border-l border-gray-100">
              <div className={`w-8 h-8 rounded-full ${roleColor} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                {profile?.full_name?.charAt(0) || '?'}
              </div>
              <div className="hidden md:block leading-tight">
                <div className="text-[13px] font-semibold text-gray-900">{profile?.full_name?.split(' ')[0]}</div>
                <div className="text-[10px] text-gray-400">{ROLE_LABEL[profile?.role || '']}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="w-full p-4 lg:p-6 xl:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

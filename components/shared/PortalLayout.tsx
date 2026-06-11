'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard, Users, UserCheck, DollarSign, BookOpen,
  Bell, LogOut, Menu, X, GraduationCap, TrendingUp,
  ClipboardList, Settings, Building2, ChevronRight,
  Kanban, Radio, CalendarCheck, FolderOpen, BarChart3,
  Shield, ArrowLeft, ChevronDown, UserPlus, Search
} from 'lucide-react'

/* ── All portal modules ─────────────────────────────────────── */
export const ALL_PORTALS = [
  { id: 'dashboard',   label: 'Dashboard',    icon: LayoutDashboard, href: '/__home__' },
  { id: 'leads',       label: 'CRM / Leads',  icon: TrendingUp,      href: '/admin/leads',
    children: [
      { label: 'All Leads',     href: '/admin/leads' },
      { label: 'Pipeline',      href: '/admin/pipeline' },
      { label: 'Add Lead',      href: '/admin/leads/new' },
      { label: 'Import Leads',  href: '/admin/leads/import' },
    ]},
  { id: 'my_leads',    label: 'My Leads',     icon: TrendingUp,      href: '/marketer',
    children: [
      { label: 'My Leads',   href: '/marketer' },
      { label: 'Follow-ups', href: '/marketer/activities' },
      { label: 'My Link',    href: '/marketer/link' },
    ]},
  { id: 'pm_leads',    label: 'Lead Inbox',   icon: TrendingUp,      href: '/pm',
    children: [
      { label: 'Lead Inbox', href: '/pm' },
      { label: 'Reports',    href: '/pm/reports' },
    ]},
  { id: 'admissions',  label: 'Admissions',   icon: UserCheck,       href: '/admin/admissions',
    children: [
      { label: 'All Admissions', href: '/admin/admissions' },
      { label: 'Applications',   href: '/admin/applications' },
    ]},
  { id: 'finance',     label: 'Finance',      icon: DollarSign,      href: '/admin/finance',
    children: [
      { label: 'Payments', href: '/admin/finance' },
      { label: 'Invoices', href: '/finance/invoices/new' },
      { label: 'Reports',  href: '/finance/reports' },
    ]},
  { id: 'broadcast',   label: 'Broadcast',    icon: Radio,           href: '/admin/broadcast' },
  { id: 'attendance',  label: 'Attendance',   icon: CalendarCheck,   href: '/admin/attendance' },
  { id: 'academics',   label: 'Academics',    icon: BookOpen,        href: '/admin/courses',
    children: [
      { label: 'Courses', href: '/admin/courses' },
      { label: 'Classes', href: '/admin/classes' },
    ]},
  { id: 'documents',   label: 'Documents',    icon: FolderOpen,      href: '/admin/documents' },
  { id: 'marketers',   label: 'Marketers',    icon: BarChart3,       href: '/admin/marketers' },
  { id: 'alumni',      label: 'Alumni',       icon: GraduationCap,   href: '/admin/alumni' },
  { id: 'staff',       label: 'Staff',        icon: Users,           href: '/admin/staff',
    children: [
      { label: 'All Staff', href: '/admin/staff' },
      { label: 'Reports',   href: '/admin/reports' },
    ]},
  { id: 'my_classes',  label: 'My Classes',   icon: BookOpen,        href: '/trainer' },
  { id: 'my_payments', label: 'My Payments',  icon: DollarSign,      href: '/student' },
  { id: 'reminders',   label: 'Reminders',    icon: Bell,            href: '/receptionist' },
  { id: 'settings',    label: 'Settings',     icon: Settings,        href: '/admin/settings' },
]

const ROLE_HOME: Record<string, string> = {
  super_admin: '/admin', project_manager: '/pm', marketing_officer: '/marketer',
  admissions_officer: '/admission', accountant: '/finance',
  receptionist: '/receptionist', trainer: '/trainer', student: '/student',
}

const ROLE_DEFAULTS: Record<string, string[]> = {
  super_admin:       ['dashboard','leads','admissions','finance','broadcast','attendance','academics','documents','marketers','alumni','staff','settings'],
  project_manager:   ['dashboard','pm_leads','leads','admissions'],
  marketing_officer: ['dashboard','my_leads','leads'],
  admissions_officer:['dashboard','admissions','leads'],
  accountant:        ['dashboard','finance','leads'],
  receptionist:      ['dashboard','reminders','attendance'],
  trainer:           ['dashboard','my_classes','attendance'],
  student:           ['dashboard','my_payments'],
}

const ROLE_LABEL: Record<string, string> = {
  super_admin:'Super Admin', project_manager:'Project Manager',
  marketing_officer:'Marketing Officer', admissions_officer:'Admissions Officer',
  accountant:'Accountant', receptionist:'Receptionist',
  trainer:'Trainer', student:'Student',
}

/* ── Icon strip color per role ──────────────────────────────── */
const ROLE_COLOR: Record<string, string> = {
  super_admin:'#7c3aed', project_manager:'#2563eb',
  marketing_officer:'#16a34a', admissions_officer:'#4338ca',
  accountant:'#d97706', receptionist:'#db2777',
  trainer:'#ea580c', student:'#6b7280',
}

function getNavItems(profile: any) {
  const ids: string[] = profile?.portals?.length
    ? profile.portals
    : ROLE_DEFAULTS[profile?.role] || ['dashboard']

  return ids.map(id => {
    const p = ALL_PORTALS.find(x => x.id === id)
    if (!p) return null
    const href = p.href === '/__home__' ? (ROLE_HOME[profile?.role] || '/admin') : p.href
    return { ...p, href }
  }).filter(Boolean) as typeof ALL_PORTALS
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const sb       = createClient()

  const [profile,     setProfile]     = useState<any>(null)
  const [loading,     setLoading]     = useState(true)
  const [mobileOpen,  setMobileOpen]  = useState(false)
  const [openGroups,  setOpenGroups]  = useState<Set<string>>(new Set())
  const [activeIcon,  setActiveIcon]  = useState<string | null>(null)
  const [unread,      setUnread]      = useState(0)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(s => {
      if (!s?.valid) { router.replace('/login'); return }
      sb.from('profiles').select('*').eq('id', s.userId).single()
        .then(({ data }) => { setProfile(data); setLoading(false) })
    }).catch(() => router.replace('/login'))
  }, [])

  useEffect(() => {
    if (!profile) return
    sb.from('notifications').select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id).eq('is_read', false)
      .then(({ count }) => setUnread(count || 0))
  }, [profile?.id])

  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Auto-set active icon section based on pathname
  useEffect(() => {
    if (!profile) return
    const items = getNavItems(profile)
    for (const item of items) {
      if (item.children?.some((c: any) => pathname.startsWith(c.href)) ||
          pathname === item.href || pathname.startsWith(item.href + '/')) {
        setActiveIcon(item.id)
        break
      }
    }
  }, [pathname, profile?.id])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  if (loading) return (
    <div className="fixed inset-0 bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    </div>
  )

  const navItems    = profile ? getNavItems(profile) : []
  const roleColor   = ROLE_COLOR[profile?.role || ''] || '#2563eb'
  const segments    = pathname.split('/').filter(Boolean)
  const canGoBack   = segments.length > 1

  // Active section's children (shown in main sidebar)
  const activeSection = activeIcon
    ? navItems.find(i => i.id === activeIcon)
    : navItems[0]

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white">

      {/* ── Column 1: Narrow icon strip ─────────────────────────── */}
      <div className="hidden lg:flex flex-col bg-white border-r border-gray-100 flex-shrink-0 z-20"
        style={{ width: 68 }}>

        {/* Logo */}
        <div className="flex items-center justify-center border-b border-gray-100 flex-shrink-0" style={{ height: 60 }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-black"
            style={{ backgroundColor: roleColor }}>
            CC
          </div>
        </div>

        {/* Icons */}
        <nav className="flex-1 overflow-y-auto py-3 flex flex-col items-center gap-1">
          {navItems.map(item => {
            const Icon  = item.icon
            const isAct = activeIcon === item.id
            return (
              <button key={item.id}
                onClick={() => setActiveIcon(item.id)}
                title={item.label}
                className={`
                  w-11 h-11 rounded-xl flex items-center justify-center transition-all
                  ${isAct ? 'text-white' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}
                `}
                style={isAct ? { backgroundColor: roleColor } : {}}>
                <Icon size={18} />
              </button>
            )
          })}
        </nav>

        {/* Bottom: notifications + user avatar */}
        <div className="flex flex-col items-center gap-2 py-4 border-t border-gray-100 flex-shrink-0">
          <button className="relative w-11 h-11 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <Bell size={18} />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
          <button onClick={logout} title="Logout"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
            <LogOut size={18} />
          </button>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: roleColor }}>
            {profile?.full_name?.charAt(0) || '?'}
          </div>
        </div>
      </div>

      {/* ── Column 2: Main sidebar with labels ──────────────────── */}
      <div className={`
        hidden lg:flex flex-col bg-white border-r border-gray-100 flex-shrink-0 z-20
      `} style={{ width: 220 }}>

        {/* Section title */}
        <div className="flex items-center px-5 border-b border-gray-100 flex-shrink-0" style={{ height: 60 }}>
          <div>
            <div className="text-[13px] font-bold text-gray-900 truncate">
              {activeSection?.label || 'Navigation'}
            </div>
            <div className="text-[10px] text-gray-400 truncate">
              {ROLE_LABEL[profile?.role || '']}
            </div>
          </div>
        </div>

        {/* Nav items for active section */}
        <nav className="flex-1 overflow-y-auto py-3 px-3">
          {activeSection?.children ? (
            /* Show children of active group */
            <>
              {activeSection.children.map((child: any) => {
                const active = pathname === child.href || pathname.startsWith(child.href + '/')
                return (
                  <Link key={child.href} href={child.href}
                    className={`
                      flex items-center justify-between px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors mb-0.5
                      ${active ? 'text-gray-900 bg-gray-100 font-semibold' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}
                    `}>
                    {child.label}
                    {active && <ChevronRight size={13} className="text-gray-400" />}
                  </Link>
                )
              })}
              {/* Back to main */}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-[10px] font-bold text-gray-300 uppercase tracking-wide px-3 mb-2">All Sections</p>
                {navItems.filter(i => i.id !== activeSection.id).map(item => {
                  const Icon = item.icon
                  return (
                    <button key={item.id} onClick={() => setActiveIcon(item.id)}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-[12px] text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors mb-0.5">
                      <Icon size={14} />
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            /* Active section has no children — show all items as flat list */
            <>
              {activeSection && (
                <Link href={activeSection.href}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-colors mb-0.5
                    ${pathname === activeSection.href || pathname.startsWith(activeSection.href + '/') ? 'text-gray-900 bg-gray-100' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}
                  `}>
                  {activeSection.label}
                  <ChevronRight size={13} className="text-gray-400" />
                </Link>
              )}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-[10px] font-bold text-gray-300 uppercase tracking-wide px-3 mb-2">All Sections</p>
                {navItems.filter(i => i.id !== activeSection?.id).map(item => {
                  const Icon = item.icon
                  return (
                    <button key={item.id} onClick={() => setActiveIcon(item.id)}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-[12px] text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors mb-0.5">
                      <Icon size={14} />
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </nav>

        {/* Footer: PIN + logout */}
        <div className="border-t border-gray-100 p-3 flex-shrink-0">
          <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{ backgroundColor: roleColor }}>
              {profile?.full_name?.charAt(0) || '?'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-gray-900 truncate leading-tight">{profile?.full_name}</div>
              <div className="text-[10px] text-gray-400">{ROLE_LABEL[profile?.role || '']}</div>
            </div>
          </div>
          <div className="flex gap-1.5">
            <Link href="/admin/settings/change-pin"
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
              <Shield size={11} /> PIN
            </Link>
            <button onClick={logout}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <LogOut size={11} /> Logout
            </button>
          </div>
        </div>
      </div>

      {/* ── Mobile drawer ───────────────────────────────────────── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 h-full bg-white shadow-2xl flex flex-col" style={{ width: 280 }}>
            <div className="flex items-center justify-between px-5 border-b border-gray-100" style={{ height: 60 }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-black" style={{ backgroundColor: roleColor }}>CC</div>
                <div>
                  <div className="text-[13px] font-bold text-gray-900">Cambridge CE</div>
                  <div className="text-[10px] text-gray-400">{ROLE_LABEL[profile?.role || '']}</div>
                </div>
              </div>
              <button onClick={() => setMobileOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
                <X size={16} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-3 px-3">
              {navItems.map(item => {
                const Icon   = item.icon
                const isOpen = openGroups.has(item.id)
                const childActive = item.children?.some((c: any) => pathname.startsWith(c.href))
                const selfActive  = !item.children && (pathname === item.href || pathname.startsWith(item.href + '/'))
                const active = selfActive || childActive
                return (
                  <div key={item.id}>
                    {item.children ? (
                      <button onClick={() => setOpenGroups(s => { const n = new Set(s); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n })}
                        className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors mb-0.5 ${active ? 'text-gray-900 bg-gray-100' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`}>
                        <Icon size={17} className="flex-shrink-0" />
                        <span className="flex-1 text-left">{item.label}</span>
                        <ChevronDown size={13} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                    ) : (
                      <Link href={item.href}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors mb-0.5 ${selfActive ? 'text-gray-900 bg-gray-100 font-semibold' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`}>
                        <Icon size={17} className="flex-shrink-0" />
                        {item.label}
                      </Link>
                    )}
                    {item.children && isOpen && (
                      <div className="ml-4 pl-3 border-l border-gray-200 mb-1 space-y-0.5">
                        {item.children.map((child: any) => {
                          const ca = pathname === child.href || pathname.startsWith(child.href + '/')
                          return (
                            <Link key={child.href} href={child.href}
                              className={`flex items-center justify-between px-3 py-2 rounded-xl text-[12px] font-medium transition-colors ${ca ? 'text-gray-900 bg-gray-100' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'}`}>
                              {child.label}
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </nav>
            <div className="border-t border-gray-100 p-4 flex-shrink-0">
              <div className="flex gap-2">
                <Link href="/admin/settings/change-pin" className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-[12px] text-gray-500 hover:bg-gray-100 transition-colors"><Shield size={13} /> PIN</Link>
                <button onClick={logout} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-[12px] text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors"><LogOut size={13} /> Logout</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Topbar */}
        <header className="flex-shrink-0 bg-white border-b border-gray-100 flex items-center gap-3 px-5"
          style={{ height: 60 }}>
          <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors">
            <Menu size={19} />
          </button>
          {canGoBack && (
            <button onClick={() => router.back()}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-100 px-3 py-1.5 rounded-xl transition-colors">
              <ArrowLeft size={15} />
              <span className="hidden sm:inline font-medium">Back</span>
            </button>
          )}
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 text-[13px] min-w-0 flex-1">
            {segments.map((seg, i) => {
              const href   = '/' + segments.slice(0, i + 1).join('/')
              const isLast = i === segments.length - 1
              const label  = seg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
              return (
                <span key={href} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <ChevronRight size={12} className="text-gray-300 flex-shrink-0" />}
                  {isLast
                    ? <span className="font-semibold text-gray-900 truncate">{label}</span>
                    : <Link href={href} className="text-gray-400 hover:text-gray-700 hidden sm:block truncate transition-colors">{label}</Link>}
                </span>
              )
            })}
          </div>
          {/* Right */}
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
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                style={{ backgroundColor: roleColor }}>
                {profile?.full_name?.charAt(0) || '?'}
              </div>
              <span className="hidden md:block text-[13px] font-semibold text-gray-900">
                {profile?.full_name?.split(' ')[0]}
              </span>
            </div>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-gray-50">
          <div className="w-full p-5 lg:p-7">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

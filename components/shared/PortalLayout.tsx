'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard, Users, UserCheck, DollarSign, BookOpen,
  Bell, LogOut, Menu, X, GraduationCap, TrendingUp,
  ClipboardList, Settings, Building2, ChevronRight,
  Kanban, Radio, CalendarCheck, FolderOpen, BarChart3,
  Shield, ArrowLeft, ChevronDown, ChevronUp, UserPlus,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react'

/* ── All available portal modules ───────────────────────────── */
export const ALL_PORTALS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    href: (role: string) => `/${roleBase(role)}`,
  },
  {
    id: 'leads',
    label: 'CRM / Leads',
    icon: TrendingUp,
    href: '/admin/leads',
    children: [
      { label: 'All Leads',     href: '/admin/leads' },
      { label: 'Lead Pipeline', href: '/admin/pipeline' },
      { label: 'Add Lead',      href: '/admin/leads/new' },
      { label: 'Import Leads',  href: '/admin/leads/import' },
    ],
  },
  {
    id: 'admissions',
    label: 'Admissions',
    icon: UserCheck,
    href: '/admin/admissions',
    children: [
      { label: 'All Admissions', href: '/admin/admissions' },
      { label: 'Applications',   href: '/admin/applications' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: DollarSign,
    href: '/admin/finance',
    children: [
      { label: 'Payments', href: '/admin/finance' },
      { label: 'Invoices', href: '/finance/invoices/new' },
      { label: 'Reports',  href: '/finance/reports' },
    ],
  },
  {
    id: 'broadcast',
    label: 'Broadcast',
    icon: Radio,
    href: '/admin/broadcast',
  },
  {
    id: 'attendance',
    label: 'Attendance',
    icon: CalendarCheck,
    href: '/admin/attendance',
  },
  {
    id: 'academics',
    label: 'Academics',
    icon: BookOpen,
    href: '/admin/courses',
    children: [
      { label: 'Courses', href: '/admin/courses' },
      { label: 'Classes', href: '/admin/classes' },
    ],
  },
  {
    id: 'documents',
    label: 'Documents',
    icon: FolderOpen,
    href: '/admin/documents',
  },
  {
    id: 'marketers',
    label: 'Marketers',
    icon: BarChart3,
    href: '/admin/marketers',
  },
  {
    id: 'alumni',
    label: 'Alumni',
    icon: GraduationCap,
    href: '/admin/alumni',
  },
  {
    id: 'staff',
    label: 'Staff',
    icon: Users,
    href: '/admin/staff',
    children: [
      { label: 'All Staff', href: '/admin/staff' },
      { label: 'Reports',   href: '/admin/reports' },
    ],
  },
  {
    id: 'my_leads',
    label: 'My Leads',
    icon: TrendingUp,
    href: '/marketer',
    children: [
      { label: 'My Leads',   href: '/marketer' },
      { label: 'Follow-ups', href: '/marketer/activities' },
      { label: 'My Link',    href: '/marketer/link' },
    ],
  },
  {
    id: 'pm_leads',
    label: 'Lead Inbox',
    icon: TrendingUp,
    href: '/pm',
    children: [
      { label: 'Lead Inbox', href: '/pm' },
      { label: 'Reports',    href: '/pm/reports' },
    ],
  },
  {
    id: 'my_classes',
    label: 'My Classes',
    icon: BookOpen,
    href: '/trainer',
  },
  {
    id: 'my_payments',
    label: 'My Payments',
    icon: DollarSign,
    href: '/student',
  },
  {
    id: 'reminders',
    label: 'Reminders',
    icon: Bell,
    href: '/receptionist',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    href: '/admin/settings',
  },
]

/* ── Default portals per role ───────────────────────────────── */
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

function roleBase(role: string) {
  const map: Record<string,string> = {
    super_admin:'admin', project_manager:'pm', marketing_officer:'marketer',
    admissions_officer:'admission', accountant:'finance', receptionist:'receptionist',
    trainer:'trainer', student:'student',
  }
  return map[role] || 'admin'
}

const ROLE_LABEL: Record<string, string> = {
  super_admin:'Super Admin', project_manager:'Project Manager',
  marketing_officer:'Marketing Officer', admissions_officer:'Admissions Officer',
  accountant:'Accountant', receptionist:'Receptionist',
  trainer:'Trainer', student:'Student',
}

const ROLE_COLOR: Record<string, string> = {
  super_admin:'bg-purple-600', project_manager:'bg-blue-600',
  marketing_officer:'bg-green-600', admissions_officer:'bg-indigo-600',
  accountant:'bg-amber-600', receptionist:'bg-pink-600',
  trainer:'bg-orange-600', student:'bg-gray-500',
}

const W_FULL = 252
const W_ICON = 64

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const sb       = createClient()

  const [profile,    setProfile]    = useState<any>(null)
  const [loading,    setLoading]    = useState(true)
  const [pinned,     setPinned]     = useState(true)
  const [hovered,    setHovered]    = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [unread,     setUnread]     = useState(0)
  const leaveTimer = useRef<any>(null)
  const expanded = pinned || hovered

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

  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Auto-open groups containing active path
  useEffect(() => {
    if (!profile) return
    getNavItems(profile).forEach(item => {
      if (item.children?.some((c: any) => pathname === c.href || (c.href.length > 4 && pathname.startsWith(c.href + '/')))) {
        setOpenGroups(s => { const n = new Set(s); n.add(item.id); return n })
      }
    })
  }, [pathname, profile?.id])

  function toggleGroup(id: string) {
    setOpenGroups(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function onEnter() { clearTimeout(leaveTimer.current); if (!pinned) setHovered(true) }
  function onLeave() { leaveTimer.current = setTimeout(() => setHovered(false), 150) }
  async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); router.replace('/login') }

  /* ── Build nav from profile permissions ─────────────────────── */
  function getNavItems(prof: any) {
    const portalIds: string[] = prof.portals?.length
      ? prof.portals
      : ROLE_DEFAULTS[prof.role] || ['dashboard']

    return portalIds.map((id: string) => {
      const portal = ALL_PORTALS.find(p => p.id === id)
      if (!portal) return null
      return {
        ...portal,
        href: typeof portal.href === 'function' ? portal.href(prof.role) : portal.href,
      }
    }).filter(Boolean) as any[]
  }

  if (loading) return (
    <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-50">
      <div className="text-center">
        <div className="w-12 h-12 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-400 text-sm font-medium">Loading workspace…</p>
      </div>
    </div>
  )

  const navItems  = profile ? getNavItems(profile) : []
  const roleColor = ROLE_COLOR[profile?.role || ''] || 'bg-blue-600'
  const segments  = pathname.split('/').filter(Boolean)
  const canGoBack = segments.length > 1

  /* ── Nav item ───────────────────────────────────────────────── */
  const NavItem = ({ item, mob = false }: { item: any; mob?: boolean }) => {
    const show     = mob || expanded
    const Icon     = item.icon
    const isGroup  = !!item.children?.length
    const isOpen   = openGroups.has(item.id)

    const selfActive  = pathname === item.href
    const childActive = item.children?.some((c: any) =>
      pathname === c.href || (c.href.length > 4 && pathname.startsWith(c.href + '/'))
    )
    const active = !isGroup && (selfActive || (item.href?.length > 4 && pathname.startsWith(item.href + '/')))
    const litGroup = isGroup && childActive

    const rowCls = `
      flex items-center w-full rounded-xl transition-colors duration-100
      ${show ? 'gap-3 px-3 py-2.5' : 'justify-center py-3 px-0'}
    `

    if (isGroup) return (
      <div>
        <button onClick={() => show && toggleGroup(item.id)} title={!show ? item.label : undefined}
          className={`${rowCls} ${litGroup ? 'bg-blue-600/20 text-blue-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
          <Icon size={18} className="flex-shrink-0" />
          {show && <>
            <span className="flex-1 text-left text-[13px] font-medium truncate">{item.label}</span>
            {isOpen ? <ChevronUp size={13} className="opacity-40" /> : <ChevronDown size={13} className="opacity-40" />}
          </>}
        </button>
        {show && isOpen && (
          <div className="ml-2 mt-0.5 pl-3.5 border-l border-slate-700/70 space-y-0.5 mb-1">
            {item.children.map((child: any) => {
              const ca = pathname === child.href || (child.href.length > 4 && pathname.startsWith(child.href + '/'))
              return (
                <Link key={child.href} href={child.href}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl text-[12px] font-medium transition-colors
                    ${ca ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                  {child.label}
                  {ca && <ChevronRight size={10} className="opacity-60" />}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    )

    return (
      <Link href={item.href} title={!show ? item.label : undefined}
        className={`${rowCls} ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
        <Icon size={18} className="flex-shrink-0" />
        {show && <>
          <span className="flex-1 text-[13px] font-medium truncate">{item.label}</span>
          {active && <ChevronRight size={13} className="opacity-50 flex-shrink-0" />}
        </>}
      </Link>
    )
  }

  /* ── Sidebar body ───────────────────────────────────────────── */
  const Sidebar = ({ mob = false }: { mob?: boolean }) => {
    const show = mob || expanded
    return (
      <div className="flex flex-col h-full w-full bg-slate-900 overflow-hidden">
        {/* Brand */}
        <div className={`flex items-center border-b border-slate-800 flex-shrink-0 ${show ? 'px-4 gap-3' : 'justify-center px-0'}`}
          style={{ height: 60 }}>
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-600/30">
            <Building2 size={17} className="text-white" />
          </div>
          {show && (
            <div className="flex-1 min-w-0">
              <div className="text-white text-[13px] font-bold leading-tight truncate">Cambridge CE</div>
              <div className="text-blue-400/80 text-[10px] truncate font-medium">
                {profile?.full_name?.split(' ')[0]} · {ROLE_LABEL[profile?.role] || ''}
              </div>
            </div>
          )}
          {mob ? (
            <button onClick={() => setMobileOpen(false)}
              className="ml-auto p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
              <X size={16} />
            </button>
          ) : show && (
            <button onClick={() => { setPinned(false); setHovered(false) }} title="Collapse sidebar"
              className="ml-auto p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {navItems.map(item => <NavItem key={item.id} item={item} mob={mob} />)}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-800 p-3 flex-shrink-0">
          {show ? (
            <>
              <div className="flex items-center gap-2.5 px-1 py-1 mb-2">
                <div className={`w-9 h-9 rounded-full ${roleColor} flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}>
                  {profile?.full_name?.charAt(0) || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-white text-[13px] font-semibold truncate leading-tight">{profile?.full_name}</div>
                  <div className="text-slate-500 text-[10px]">{profile?.phone?.replace(/^233/, '0')}</div>
                </div>
              </div>
              <div className="flex gap-1.5">
                <Link href="/admin/settings/change-pin"
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl text-[11px] transition-colors">
                  <Shield size={11} /> Change PIN
                </Link>
                <button onClick={logout}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-xl text-[11px] transition-colors">
                  <LogOut size={11} /> Logout
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className={`w-9 h-9 rounded-full ${roleColor} flex items-center justify-center text-white text-sm font-bold`}>
                {profile?.full_name?.charAt(0) || '?'}
              </div>
              <button onClick={logout} title="Logout"
                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors">
                <LogOut size={14} />
              </button>
              <button onClick={() => setPinned(true)} title="Expand sidebar"
                className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                <PanelLeftOpen size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const pageTitle = segments[segments.length - 1]
    ?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Dashboard'

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50">

      {/* Desktop sidebar */}
      <aside
        className="hidden lg:block relative flex-shrink-0 z-10"
        style={{ width: expanded ? W_FULL : W_ICON, transition: 'width 0.2s ease' }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}>
        {/* Floating panel when collapsed+hovered */}
        {!pinned && hovered ? (
          <div className="absolute inset-y-0 left-0 shadow-2xl shadow-black/40 z-50" style={{ width: W_FULL }}>
            <Sidebar />
          </div>
        ) : (
          <Sidebar />
        )}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 shadow-2xl" style={{ width: W_FULL }}>
            <Sidebar mob />
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="flex-shrink-0 bg-white border-b border-gray-200 flex items-center gap-2 px-4 lg:px-5"
          style={{ height: 60 }}>
          <button onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors">
            <Menu size={20} />
          </button>
          {canGoBack && (
            <button onClick={() => router.back()}
              className="flex items-center gap-1.5 h-8 px-3 text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors">
              <ArrowLeft size={15} /><span className="hidden sm:inline">Back</span>
            </button>
          )}
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
                    : <Link href={href} className="text-gray-400 hover:text-gray-700 truncate hidden sm:block">{label}</Link>}
                </span>
              )
            })}
          </nav>
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
                <div className="text-[13px] font-bold text-gray-900">{profile?.full_name?.split(' ')[0]}</div>
                <div className="text-[10px] text-gray-400">{ROLE_LABEL[profile?.role || '']}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="w-full p-4 lg:p-6 xl:p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}

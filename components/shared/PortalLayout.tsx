'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import CommandPalette from '@/components/shared/CommandPalette'
import NotificationBell from '@/components/shared/NotificationBell'
import {
  LayoutDashboard, Users, UserCheck, DollarSign, BookOpen,
  Bell, LogOut, Menu, X, GraduationCap, TrendingUp,
  ClipboardList, Settings, Building2, ChevronRight,
  Radio, CalendarCheck, FolderOpen, BarChart3, Search, Sparkles, Flame, MessageSquare, Trophy,
  Shield, ArrowLeft, ChevronDown, UserPlus, Link2
} from 'lucide-react'

/* ── All portal modules ─────────────────────────────────────── */
export const ALL_PORTALS = [
  { id: 'dashboard',   label: 'Dashboard',    icon: LayoutDashboard, href: '/__home__' },
  { id: 'insights',    label: 'Insights',     icon: BarChart3,       href: '/admin/insights' },
  { id: 'leads',       label: 'CRM / Leads',  icon: TrendingUp,      href: '/admin/leads',
    children: [
      { label: 'All Leads',       href: '/admin/leads' },
      { label: 'Leads by Course', href: '/admin/leads/courses' },
      { label: 'Pipeline',        href: '/admin/pipeline' },
      { label: 'Conversions',     href: '/admin/conversions' },
      { label: 'Add Lead',        href: '/admin/leads/new' },
      { label: 'Import Leads',    href: '/admin/leads/import' },
    ]},
  { id: 'my_leads',    label: 'My Leads',     icon: TrendingUp,      href: '/marketer',
    children: [
      { label: 'My Leads',        href: '/marketer' },
      { label: 'Leads by Course', href: '/admin/leads/courses' },
      { label: 'My Conversions',  href: '/admin/conversions' },
      { label: 'Add a Lead',      href: '/marketer/leads/new' },
      { label: 'Follow-ups',      href: '/marketer/activities' },
    ]},
  { id: 'my_link',     label: 'My Link',      icon: Radio,           href: '/marketer/link' },
  { id: 'pm_leads',    label: 'Lead Inbox',   icon: TrendingUp,      href: '/pm',
    children: [
      { label: 'Lead Inbox', href: '/pm' },
      { label: 'Reports',    href: '/pm/reports' },
    ]},
  { id: 'admissions',  label: 'Admissions',   icon: UserCheck,       href: '/admin/admissions',
    children: [
      { label: 'All Admissions', href: '/admin/admissions' },
      { label: 'Applications',   href: '/admission' },
    ]},
  { id: 'finance',     label: 'Finance',      icon: DollarSign,      href: '/admin/finance',
    children: [
      { label: 'Payments', href: '/admin/finance' },
      { label: 'Invoices', href: '/finance/invoices/new' },
      { label: 'Reports',  href: '/finance/reports' },
    ]},
  { id: 'broadcast',   label: 'Broadcast',    icon: Radio,           href: '/admin/broadcast' },
  { id: 'attendance',  label: 'Attendance',   icon: CalendarCheck,   href: '/admin/attendance' },
  { id: 'academics',   label: 'Academics',    icon: BookOpen,        href: '/admin/academics',
    children: [
      { label: 'Overview', href: '/admin/academics' },
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
  { id: 'workforce',   label: 'Workforce',    icon: CalendarCheck,   href: '/admin/workforce' },
  { id: 'signins',     label: 'Walk-in Sign-ins', icon: ClipboardList, href: '/admin/signins' },
  { id: 'wa_lines',    label: 'WhatsApp Lines', icon: Radio,         href: '/admin/whatsapp' },
  { id: 'knowledge',   label: 'AI Knowledge', icon: Sparkles,         href: '/admin/knowledge' },
  { id: 'conversations', label: 'AI Conversations', icon: MessageSquare, href: '/admin/conversations' },
  { id: 'hotleads',    label: 'Hot Leads',    icon: Flame,           href: '/admin/hotleads' },
  { id: 'remuneration', label: 'Remuneration', icon: Trophy,          href: '/admin/remuneration' },
  { id: 'clock_in',    label: 'Clock In',     icon: CalendarCheck,   href: '/clock-in' },
  { id: 'my_links',    label: 'My Links',     icon: Link2,           href: '/links' },
  { id: 'prep',        label: 'Exam Prep',    icon: ClipboardList,   href: '/coordinator',
    children: [
      { label: 'Prep Tracker',  href: '/coordinator' },
      { label: 'Testimonials',  href: '/coordinator/testimonials' },
    ]},
  { id: 'settings',    label: 'Settings',     icon: Settings,        href: '/admin/settings' },

  // ── Category groups (used by super_admin for a tidy, organised sidebar) ──
  { id: 'grp_growth', label: 'Growth', icon: TrendingUp, href: '/admin/leads', children: [
    { label: 'All Leads',       href: '/admin/leads' },
    { label: 'Leads by Course', href: '/admin/leads/courses' },
    { label: 'Pipeline',        href: '/admin/pipeline' },
    { label: 'Hot Leads',       href: '/admin/hotleads' },
    { label: 'Conversions',     href: '/admin/conversions' },
    { label: 'Add Lead',        href: '/admin/leads/new' },
    { label: 'Import',          href: '/admin/leads/import' },
    { label: 'Marketers',       href: '/admin/marketers' },
    { label: 'Remuneration',    href: '/admin/remuneration' },
  ]},
  { id: 'grp_enrolment', label: 'Enrolment', icon: UserCheck, href: '/admin/admissions', children: [
    { label: 'Admissions',       href: '/admin/admissions' },
    { label: 'Student Records',  href: '/admin/registrations' },
    { label: 'Walk-in Sign-ins', href: '/admin/signins' },
  ]},
  { id: 'grp_finance', label: 'Finance', icon: DollarSign, href: '/finance', children: [
    { label: 'Payments & Invoices', href: '/finance' },
    { label: 'Registrations',       href: '/finance/registrations' },
    { label: 'Reports',             href: '/finance/reports' },
  ]},
  { id: 'grp_academics', label: 'Academics', icon: BookOpen, href: '/admin/academics', children: [
    { label: 'Overview',     href: '/admin/academics' },
    { label: 'Courses',      href: '/admin/courses' },
    { label: 'Classes',      href: '/admin/classes' },
    { label: 'Attendance',   href: '/admin/attendance' },
    { label: 'Certificates', href: '/admin/certificates' },
    { label: 'Exam Prep',    href: '/coordinator' },
    { label: 'Testimonials', href: '/coordinator/testimonials' },
    { label: 'Alumni',       href: '/admin/alumni' },
  ]},
  { id: 'grp_messaging', label: 'Messaging & AI', icon: MessageSquare, href: '/admin/broadcast', children: [
    { label: 'Broadcast',        href: '/admin/broadcast' },
    { label: 'Post a Link',      href: '/admin/links' },
    { label: 'Follow-up Sequences', href: '/admin/sequences' },
    { label: 'WhatsApp Lines',   href: '/admin/whatsapp' },
    { label: 'AI Knowledge',     href: '/admin/knowledge' },
    { label: 'AI Conversations', href: '/admin/conversations' },
  ]},
  { id: 'grp_team', label: 'Team', icon: Users, href: '/admin/staff', children: [
    { label: 'Staff',     href: '/admin/staff' },
    { label: 'Workforce', href: '/admin/workforce' },
    { label: 'Clock In',  href: '/clock-in' },
  ]},
  { id: 'grp_content', label: 'Content & System', icon: FolderOpen, href: '/admin/documents', children: [
    { label: 'Documents', href: '/admin/documents' },
    { label: 'Settings',  href: '/admin/settings' },
  ]},
]

const ROLE_HOME: Record<string, string> = {
  super_admin: '/admin', project_manager: '/pm', marketing_officer: '/marketer',
  admissions_officer: '/admission', accountant: '/finance',
  receptionist: '/receptionist', trainer: '/trainer', student: '/student', exam_coordinator: '/coordinator',
}

const ROLE_DEFAULTS: Record<string, string[]> = {
  super_admin:       ['dashboard','insights','grp_growth','grp_enrolment','grp_finance','grp_academics','grp_messaging','grp_team','grp_content'],
  project_manager:   ['dashboard','pm_leads','leads','admissions','my_links','clock_in'],
  marketing_officer: ['dashboard','my_leads','my_earnings','my_link','clock_in'],
  admissions_officer:['dashboard','admissions','leads','my_links','clock_in'],
  accountant:        ['dashboard','finance','registrations','leads','my_links','clock_in'],
  receptionist:      ['dashboard','reminders','attendance','my_links','clock_in'],
  trainer:           ['dashboard','my_classes','attendance','my_links','clock_in'],
  exam_coordinator:  ['prep','my_links','clock_in'],
  student:           ['dashboard','my_payments'],
}

const ROLE_LABEL: Record<string, string> = {
  super_admin:'Super Admin', project_manager:'Project Manager',
  marketing_officer:'Marketing Officer', admissions_officer:'Admissions Officer',
  accountant:'Accountant', receptionist:'Receptionist',
  trainer:'Trainer', student:'Student',
}

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

const W_ICON = 68
const W_FULL = 256

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()

  const [profile,    setProfile]    = useState<any>(null)
  const [loading,    setLoading]    = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [hovered,    setHovered]    = useState(false)
  const [openGroup,  setOpenGroup]  = useState<string | null>(null)
  const [unread,     setUnread]     = useState(0)
  const [courses,    setCourses]    = useState<any[]>([])
  const leaveTimer = useRef<any>(null)

  // The portal manages its own scroll inside <main>; lock the document
  // height only while the portal is mounted. Public pages scroll normally.
  useEffect(() => {
    document.documentElement.classList.add('app-shell')
    return () => document.documentElement.classList.remove('app-shell')
  }, [])

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(s => {
      if (!s?.valid) { router.replace('/login'); return }
      setProfile({ id: s.userId, full_name: s.fullName, role: s.role, email: s.email, phone: s.phone, portals: s.portals })
      setLoading(false)
    }).catch(() => router.replace('/login'))
  }, [])

  useEffect(() => {
    if (!profile) return
    const params = new URLSearchParams({
      table: 'notifications', select: 'id',
      filters: JSON.stringify([{ col: 'user_id', op: 'eq', val: profile.id }, { col: 'is_read', op: 'eq', val: false }]),
      limit: '50',
    })
    fetch(`/api/data?${params}`).then(r => r.ok ? r.json() : null).then(d => setUnread(d?.data?.length || 0)).catch(() => {})
  }, [profile?.id])

  useEffect(() => { setMobileOpen(false); setHovered(false) }, [pathname])

  // Load active courses to build per-course lead nav entries (admin/PM/marketer)
  useEffect(() => {
    if (!profile) return
    if (!['super_admin', 'project_manager', 'marketing_officer'].includes(profile.role)) return
    const params = new URLSearchParams({
      table: 'courses', select: 'id, name, code, is_active',
      filters: JSON.stringify([{ col: 'is_active', op: 'eq', val: true }]),
      orderBy: 'name', orderAsc: 'true', limit: '100',
    })
    fetch(`/api/data?${params}`).then(r => r.ok ? r.json() : { data: [] })
      .then(d => setCourses(d.data || [])).catch(() => {})
  }, [profile])

  // Auto-open the group containing the current page
  useEffect(() => {
    if (!profile) return
    const items = getNavItems(profile)
    for (const item of items) {
      if (item.children?.some((c: any) => pathname === c.href || pathname.startsWith(c.href + '/'))) {
        setOpenGroup(item.id); return
      }
    }
  }, [pathname, profile?.id])

  function onEnter() { clearTimeout(leaveTimer.current); setHovered(true) }
  function onLeave() { leaveTimer.current = setTimeout(() => setHovered(false), 150) }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  if (loading) return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'var(--canvas)' }}>
      <div className="text-center">
        <div className="w-7 h-7 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-[var(--ink-faint)] text-sm">Loading…</p>
      </div>
    </div>
  )

  const baseNavItems = profile ? getNavItems(profile) : []

  // Inject a "Leads by Course" group — one child per active course
  const navItems = (() => {
    if (!profile || !['super_admin', 'project_manager', 'marketing_officer'].includes(profile.role) || courses.length === 0) return baseNavItems
    const courseGroup: any = {
      id: 'leads_by_course', label: 'Leads by Course', icon: GraduationCap, href: '#',
      children: courses.map((c: any) => ({
        label: c.name,
        href: `/admin/leads/course/${encodeURIComponent(c.code || c.name)}`,
      })),
    }
    // place it right after the leads/my_leads group if present, else at the front
    const idx = baseNavItems.findIndex((n: any) => n.id === 'leads' || n.id === 'my_leads')
    if (idx === -1) return [...baseNavItems, courseGroup]
    const copy = [...baseNavItems]
    copy.splice(idx + 1, 0, courseGroup)
    return copy
  })()
  const roleColor = '#2f80d6'  // sky blue — unified across roles
  const segments  = pathname.split('/').filter(Boolean)
  const canGoBack = segments.length > 1
  const expanded  = hovered || mobileOpen

  /* ── Sidebar nav rows ───────────────────────────────────────── */
  const NavRows = ({ wide }: { wide: boolean }) => (
    <>
      {navItems.map(item => {
        const Icon = item.icon
        const hasKids = !!item.children?.length
        const isOpen  = openGroup === item.id

        const selfActive  = pathname === item.href || (item.href.length > 1 && pathname.startsWith(item.href + '/'))
        const childActive = item.children?.some((c: any) => pathname === c.href || pathname.startsWith(c.href + '/'))
        const active = selfActive || childActive

        if (hasKids) {
          return (
            <div key={item.id}>
              <button
                onClick={() => setOpenGroup(isOpen ? null : item.id)}
                title={!wide ? item.label : undefined}
                className={`w-full flex items-center rounded-xl transition-colors mb-0.5
                  ${wide ? 'gap-3 px-3 py-2.5' : 'justify-center py-3'}
                  ${active ? 'text-white' : 'text-[var(--ink-faint)] hover:bg-[var(--line-soft)] hover:text-[var(--ink)]'}`}
                style={active ? { backgroundColor: roleColor } : {}}>
                <Icon size={18} className="flex-shrink-0" />
                {wide && <>
                  <span className="flex-1 text-left text-[13px] font-medium truncate">{item.label}</span>
                  <ChevronDown size={14} className={`opacity-60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </>}
              </button>
              {wide && isOpen && (
                <div className="ml-4 pl-3 border-l border-[var(--line)] mb-1 space-y-0.5">
                  {item.children!.map((child: any) => {
                    const ca = pathname === child.href || pathname.startsWith(child.href + '/')
                    return (
                      <Link key={child.href} href={child.href} onClick={() => setMobileOpen(false)}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg text-[12px] font-medium transition-colors
                          ${ca ? 'bg-[var(--line-soft)] text-[var(--ink)] font-semibold' : 'text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--line-soft)]'}`}>
                        {child.label}
                        {ca && <ChevronRight size={11} className="text-[var(--ink-faint)]" />}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        }

        return (
          <Link key={item.id} href={item.href} title={!wide ? item.label : undefined}
            className={`flex items-center rounded-xl transition-colors mb-0.5
              ${wide ? 'gap-3 px-3 py-2.5' : 'justify-center py-3'}
              ${selfActive ? 'text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}`}
            style={selfActive ? { backgroundColor: roleColor } : {}}>
            <Icon size={18} className="flex-shrink-0" />
            {wide && <span className="text-[13px] font-medium truncate">{item.label}</span>}
          </Link>
        )
      })}
    </>
  )

  const SidebarPanel = ({ wide, mobile = false }: { wide: boolean; mobile?: boolean }) => (
    <div className="flex flex-col h-full bg-[var(--paper)]">
      {/* Brand */}
      <div className={`flex items-center border-b border-[var(--line)] flex-shrink-0 ${wide ? 'px-4 gap-3' : 'justify-center'}`} style={{ height: 60 }}>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-white border border-[var(--line)] overflow-hidden p-0.5">
          <img src="/brand/logo.png" alt="CCE" className="w-full h-full object-contain" />
        </div>
        {wide && (
          <div className="min-w-0 flex-1">
            <div className="font-display text-[14px] font-semibold text-[var(--ink)] truncate leading-tight">Cambridge</div>
            <div className="text-[10px] text-gray-400 truncate">{ROLE_LABEL[profile?.role || '']}</div>
          </div>
        )}
        {mobile && (
          <button onClick={() => setMobileOpen(false)} className="ml-auto p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5">
        <NavRows wide={wide} />
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--line)] p-2.5 flex-shrink-0">
        {wide ? (
          <>
            <div className="flex items-center gap-2.5 px-2 py-1.5 mb-1.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: roleColor }}>
                {profile?.full_name?.charAt(0) || '?'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-[var(--ink)] truncate">{profile?.full_name}</div>
                <div className="text-[10px] text-gray-400">{ROLE_LABEL[profile?.role || '']}</div>
              </div>
            </div>
            <div className="flex gap-1.5">
              <Link href="/admin/settings/change-pin" className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors">
                <Shield size={11} /> PIN
              </Link>
              <button onClick={logout} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                <LogOut size={11} /> Logout
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: roleColor }}>
              {profile?.full_name?.charAt(0) || '?'}
            </div>
            <button onClick={logout} title="Logout" className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: 'var(--canvas)' }}>
      <CommandPalette />

      {/* ── Desktop sidebar — collapsed strip, hover floats wide panel ── */}
      <div
        className="hidden lg:block relative flex-shrink-0 border-r border-[var(--line)] z-30"
        style={{ width: W_ICON }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}>
        <SidebarPanel wide={false} />
        {expanded && (
          <div className="absolute inset-y-0 left-0 shadow-2xl border-r border-[var(--line)]" style={{ width: W_FULL }}>
            <SidebarPanel wide={true} />
          </div>
        )}
      </div>

      {/* ── Mobile drawer ──────────────────────────────────────── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 shadow-2xl" style={{ width: W_FULL }}>
            <SidebarPanel wide={true} mobile />
          </div>
        </div>
      )}

      {/* ── Main content ───────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Topbar */}
        <header className="flex-shrink-0 bg-[var(--paper)] border-b border-[var(--line)] flex items-center gap-3 px-5" style={{ height: 60 }}>
          <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--line-soft)] rounded-xl transition-colors">
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
                  {i > 0 && <ChevronRight size={12} className="text-[var(--ink-faint)] flex-shrink-0" />}
                  {isLast
                    ? <span className="font-semibold text-[var(--ink)] truncate">{label}</span>
                    : <Link href={href} className="text-[var(--ink-faint)] hover:text-[var(--ink)] hidden sm:block truncate transition-colors">{label}</Link>}
                </span>
              )
            })}
          </div>

          {/* Right */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => { const e = new KeyboardEvent('keydown', { key: 'k', metaKey: true }); window.dispatchEvent(e) }}
              className="hidden sm:flex items-center gap-2 h-9 pl-3 pr-2 rounded-lg border border-[var(--line)] text-[var(--ink-faint)] hover:border-[var(--ink-faint)] hover:text-[var(--ink-soft)] transition-colors">
              <Search size={15} />
              <span className="text-[13px]">Search</span>
              <kbd className="text-[10px] font-semibold bg-[var(--line-soft)] px-1.5 py-0.5 rounded">⌘K</kbd>
            </button>
            <NotificationBell userId={profile?.id || null} />
            <div className="flex items-center gap-2 pl-2.5 border-l border-[var(--line)]">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: roleColor }}>
                {profile?.full_name?.charAt(0) || '?'}
              </div>
              <span className="hidden md:block text-[13px] font-semibold text-[var(--ink)]">{profile?.full_name?.split(' ')[0]}</span>
            </div>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden" style={{ background: 'var(--canvas)' }}>
          <div className="w-full px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8 mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  )
}

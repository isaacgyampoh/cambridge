'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'
import {
  LayoutDashboard, Users, UserCheck, DollarSign, BookOpen,
  Bell, LogOut, Menu, X, GraduationCap, TrendingUp,
  ClipboardList, Settings, Building2, ChevronRight,
  Kanban, Radio, CalendarCheck, FolderOpen, BarChart3,
  UserCog, Shield
} from 'lucide-react'

const NAV_BY_ROLE: Record<string, { label: string; href: string; icon: any }[]> = {
  super_admin: [
    { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
    { label: 'Lead Pipeline', href: '/admin/pipeline', icon: Kanban },
    { label: 'All Leads', href: '/admin/leads', icon: TrendingUp },
    { label: 'Admissions', href: '/admin/admissions', icon: UserCheck },
    { label: 'Finance', href: '/admin/finance', icon: DollarSign },
    { label: 'Broadcast', href: '/admin/broadcast', icon: Radio },
    { label: 'Attendance', href: '/admin/attendance', icon: CalendarCheck },
    { label: 'Courses', href: '/admin/courses', icon: BookOpen },
    { label: 'Classes', href: '/admin/classes', icon: GraduationCap },
    { label: 'Documents', href: '/admin/documents', icon: FolderOpen },
    { label: 'Marketers', href: '/admin/marketers', icon: BarChart3 },
    { label: 'Alumni', href: '/admin/alumni', icon: GraduationCap },
    { label: 'Staff', href: '/admin/staff', icon: Users },
    { label: 'Reports', href: '/admin/reports', icon: ClipboardList },
    { label: 'Settings', href: '/admin/settings', icon: Settings },
  ],
  project_manager: [
    { label: 'Dashboard', href: '/pm', icon: LayoutDashboard },
    { label: 'Lead Inbox', href: '/pm', icon: TrendingUp },
    { label: 'Reports', href: '/pm/reports', icon: ClipboardList },
  ],
  marketing_officer: [
    { label: 'Dashboard', href: '/marketer', icon: LayoutDashboard },
    { label: 'My Leads', href: '/marketer', icon: TrendingUp },
    { label: 'Follow-ups', href: '/marketer/activities', icon: Bell },
    { label: 'My Link', href: '/marketer/link', icon: Users },
  ],
  admissions_officer: [
    { label: 'Dashboard', href: '/admission', icon: LayoutDashboard },
    { label: 'Admissions', href: '/admission', icon: UserCheck },
  ],
  accountant: [
    { label: 'Dashboard', href: '/finance', icon: LayoutDashboard },
    { label: 'Payments', href: '/finance', icon: DollarSign },
    { label: 'Invoices', href: '/finance/invoices/new', icon: DollarSign },
    { label: 'Reports', href: '/finance/reports', icon: ClipboardList },
  ],
  receptionist: [
    { label: 'Dashboard', href: '/receptionist', icon: LayoutDashboard },
  ],
  trainer: [
    { label: 'Dashboard', href: '/trainer', icon: LayoutDashboard },
  ],
  student: [
    { label: 'Dashboard', href: '/student', icon: LayoutDashboard },
    { label: 'Payments', href: '/student/payments', icon: DollarSign },
  ],
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  project_manager: 'Project Manager',
  marketing_officer: 'Marketing Officer',
  admissions_officer: 'Admissions Officer',
  accountant: 'Accountant',
  receptionist: 'Receptionist',
  trainer: 'Trainer',
  student: 'Student',
}

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-purple-600',
  project_manager: 'bg-blue-600',
  marketing_officer: 'bg-green-600',
  admissions_officer: 'bg-indigo-600',
  accountant: 'bg-yellow-600',
  receptionist: 'bg-pink-600',
  trainer: 'bg-orange-600',
  student: 'bg-gray-600',
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const sb = createClient()

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(session => {
        if (!session?.valid) { router.replace('/login'); return }
        sb.from('profiles').select('*').eq('id', session.userId).single()
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

  // Close sidebar on route change
  useEffect(() => { setSidebarOpen(false) }, [pathname])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 text-sm">Loading your portal...</p>
      </div>
    </div>
  )

  const navItems = profile ? NAV_BY_ROLE[profile.role] || [] : []
  const roleColor = ROLE_COLORS[profile?.role || ''] || 'bg-blue-600'

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* ── Sidebar ── */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-60 bg-slate-900 flex flex-col
        transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0 lg:flex-shrink-0
      `}>
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-slate-800 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <Building2 size={16} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-white text-xs font-bold truncate leading-tight">Cambridge CE</div>
            <div className="text-blue-400 text-[10px] truncate">{ROLE_LABELS[profile?.role || ''] || ''}</div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-500 hover:text-white p-1">
            <X size={16} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {navItems.map(item => {
            const Icon = item.icon
            const exact = pathname === item.href
            const starts = pathname.startsWith(item.href + '/') && item.href !== '/'
            const active = exact || starts
            return (
              <Link key={item.label + item.href} href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg mb-0.5 text-[13px] font-medium transition-all duration-100 ${
                  active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}>
                <Icon size={16} className="flex-shrink-0" />
                <span className="truncate">{item.label}</span>
                {active && <ChevronRight size={12} className="ml-auto opacity-60" />}
              </Link>
            )
          })}
        </nav>

        {/* Profile footer */}
        <div className="border-t border-slate-800 p-3 flex-shrink-0">
          <div className="flex items-center gap-2.5 mb-2 px-1">
            <div className={`w-8 h-8 rounded-full ${roleColor} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
              {profile?.full_name?.charAt(0) || '?'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-white text-xs font-semibold truncate leading-tight">{profile?.full_name || '...'}</div>
              <div className="text-slate-500 text-[10px] truncate">{profile?.email}</div>
            </div>
          </div>
          <div className="flex gap-1.5">
            <Link href="/admin/settings/change-pin"
              className="flex-1 flex items-center justify-center gap-1 py-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg text-[11px] transition-colors">
              <Shield size={12} /> PIN
            </Link>
            <button onClick={logout}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg text-[11px] transition-colors">
              <LogOut size={12} /> Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Topbar */}
        <header className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-4 flex-shrink-0 gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
              <Menu size={19} />
            </button>
            {/* Breadcrumb */}
            <div className="hidden sm:flex items-center gap-1 text-sm text-gray-500">
              <span className="font-medium text-gray-900">{ROLE_LABELS[profile?.role || '']}</span>
              <ChevronRight size={14} />
              <span className="capitalize">{pathname.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || 'Dashboard'}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* Notifications bell */}
            <button className="relative p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>

            {/* Avatar */}
            <div className={`w-8 h-8 rounded-full ${roleColor} flex items-center justify-center text-white text-xs font-bold cursor-default`}>
              {profile?.full_name?.charAt(0) || '?'}
            </div>
            <span className="text-sm font-semibold text-gray-700 hidden md:block">
              {profile?.full_name?.split(' ')[0] || ''}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-5">
          {children}
        </main>
      </div>
    </div>
  )
}

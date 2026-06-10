'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'
import {
  LayoutDashboard, Users, UserCheck, DollarSign, BookOpen,
  Bell, LogOut, Menu, X, ChevronDown, GraduationCap,
  TrendingUp, ClipboardList, Settings, Building2
} from 'lucide-react'

const NAV_BY_ROLE: Record<string, { label: string; href: string; icon: any }[]> = {
  super_admin: [
    { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
    { label: 'Staff', href: '/admin/staff', icon: Users },
    { label: 'Leads', href: '/admin/leads', icon: TrendingUp },
    { label: 'Admissions', href: '/admin/admissions', icon: UserCheck },
    { label: 'Finance', href: '/admin/finance', icon: DollarSign },
    { label: 'Courses', href: '/admin/courses', icon: BookOpen },
    { label: 'Classes', href: '/admin/classes', icon: GraduationCap },
    { label: 'Attendance', href: '/admin/attendance', icon: ClipboardList },
    { label: 'Documents', href: '/admin/documents', icon: BookOpen },
    { label: 'Reports', href: '/admin/reports', icon: ClipboardList },
    { label: 'Settings', href: '/admin/settings', icon: Settings },
  ],
  project_manager: [
    { label: 'Dashboard', href: '/pm', icon: LayoutDashboard },
    { label: 'Lead Inbox', href: '/pm/leads', icon: TrendingUp },
    { label: 'Assign Leads', href: '/pm/assign', icon: Users },
    { label: 'Marketers', href: '/pm/marketers', icon: UserCheck },
    { label: 'Reports', href: '/pm/reports', icon: ClipboardList },
  ],
  marketing_officer: [
    { label: 'Dashboard', href: '/marketer', icon: LayoutDashboard },
    { label: 'My Leads', href: '/marketer/leads', icon: TrendingUp },
    { label: 'Activities', href: '/marketer/activities', icon: ClipboardList },
    { label: 'My Link', href: '/marketer/link', icon: Users },
  ],
  admissions_officer: [
    { label: 'Dashboard', href: '/admission', icon: LayoutDashboard },
    { label: 'Applications', href: '/admission/applications', icon: ClipboardList },
    { label: 'Admissions', href: '/admission/admissions', icon: UserCheck },
    { label: 'Students', href: '/admission/students', icon: GraduationCap },
  ],
  accountant: [
    { label: 'Dashboard', href: '/finance', icon: LayoutDashboard },
    { label: 'Invoices', href: '/finance/invoices', icon: DollarSign },
    { label: 'Payments', href: '/finance/payments', icon: DollarSign },
    { label: 'Reports', href: '/finance/reports', icon: ClipboardList },
  ],
  receptionist: [
    { label: 'Dashboard', href: '/receptionist', icon: LayoutDashboard },
    { label: 'Classes', href: '/receptionist/classes', icon: BookOpen },
    { label: 'Reminders', href: '/receptionist/reminders', icon: Bell },
    { label: 'Students', href: '/receptionist/students', icon: GraduationCap },
  ],
  trainer: [
    { label: 'Dashboard', href: '/trainer', icon: LayoutDashboard },
    { label: 'My Classes', href: '/trainer/classes', icon: BookOpen },
    { label: 'Students', href: '/trainer/students', icon: GraduationCap },
    { label: 'Attendance', href: '/trainer/attendance', icon: ClipboardList },
  ],
  student: [
    { label: 'Dashboard', href: '/student', icon: LayoutDashboard },
    { label: 'My Classes', href: '/student/classes', icon: BookOpen },
    { label: 'Payments', href: '/student/payments', icon: DollarSign },
    { label: 'Profile', href: '/student/profile', icon: Users },
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

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const sb = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data } = await sb.from('profiles').select('*').eq('id', user.id).single()
      setProfile(data)
    }
    load()
  }, [])

  useEffect(() => {
    if (!profile) return
    // Subscribe to realtime notifications
    const channel = sb
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${profile.id}`,
      }, () => setUnread(n => n + 1))
      .subscribe()

    // Load unread count
    sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('is_read', false)
      .then(({ count }) => setUnread(count || 0))

    return () => { sb.removeChannel(channel) }
  }, [profile])

  async function logout() {
    await sb.auth.signOut()
    router.push('/login')
  }

  const navItems = profile ? NAV_BY_ROLE[profile.role] || [] : []

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 flex flex-col transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0
      `}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 h-16 border-b border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0">
            <Building2 size={18} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-white text-sm font-bold truncate">Cambridge CE</div>
            <div className="text-slate-400 text-[10px] truncate">
              {profile ? ROLE_LABELS[profile.role] : '...'}
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="ml-auto lg:hidden text-slate-400">
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          {navItems.map(item => {
            const Icon = item.icon
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link key={item.href} href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}>
                <Icon size={18} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Profile */}
        <div className="border-t border-slate-800 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              {profile?.full_name?.charAt(0) || '?'}
            </div>
            <div className="min-w-0">
              <div className="text-white text-sm font-semibold truncate">{profile?.full_name || '...'}</div>
              <div className="text-slate-400 text-xs truncate">{profile?.email}</div>
            </div>
          </div>
          <button onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-xl text-sm transition-colors">
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6 flex-shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-gray-500 hover:text-gray-900">
            <Menu size={22} />
          </button>

          <div className="flex items-center gap-3 ml-auto">
            {/* Notifications */}
            <Link href={`/${profile?.role?.split('_')[0] || ''}/notifications`}
              className="relative p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition">
              <Bell size={20} />
              {unread > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Link>

            {/* User */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-50 border border-gray-200">
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                {profile?.full_name?.charAt(0) || '?'}
              </div>
              <span className="text-sm font-medium text-gray-700 hidden sm:block">
                {profile?.full_name?.split(' ')[0] || '...'}
              </span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  Search, LayoutDashboard, TrendingUp, UserCheck, DollarSign,
  Radio, CalendarCheck, BookOpen, FolderOpen, BarChart3,
  GraduationCap, Users, Settings, CornerDownLeft, MessageSquare,
  ClipboardList,
} from 'lucide-react'

interface Command {
  label: string
  sublabel?: string
  href: string
  icon: any
  keywords?: string
}

const COMMANDS: Command[] = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard, keywords: 'home overview' },
  { label: 'Insights', sublabel: 'Analytics & charts', href: '/admin/insights', icon: BarChart3, keywords: 'analytics charts reports data' },
  { label: 'All leads', href: '/admin/leads', icon: TrendingUp, keywords: 'crm prospects' },
  { label: 'Add a lead', href: '/admin/leads/new', icon: TrendingUp, keywords: 'new create lead' },
  { label: 'Import leads', href: '/admin/leads/import', icon: TrendingUp, keywords: 'csv upload bulk' },
  { label: 'Admissions', href: '/admin/admissions', icon: UserCheck, keywords: 'enroll students applications' },
  { label: 'Finance', href: '/admin/finance', icon: DollarSign, keywords: 'payments money invoices revenue' },
  { label: 'Broadcast', sublabel: 'Bulk WhatsApp & SMS', href: '/admin/broadcast', icon: Radio, keywords: 'message campaign bulk sms whatsapp' },
  { label: 'WhatsApp lines', href: '/admin/whatsapp', icon: MessageSquare, keywords: 'instance wawp connect line' },
  { label: 'Class attendance', href: '/admin/attendance', icon: CalendarCheck, keywords: 'sign in class session' },
  { label: 'Staff attendance', sublabel: 'Workforce', href: '/admin/workforce', icon: CalendarCheck, keywords: 'clock in office location geofence' },
  { label: 'Academics', href: '/admin/academics', icon: BookOpen, keywords: 'courses classes programmes' },
  { label: 'Courses', href: '/admin/courses', icon: BookOpen, keywords: 'programme catalogue fee' },
  { label: 'Classes', href: '/admin/classes', icon: GraduationCap, keywords: 'batch trainer schedule' },
  { label: 'Documents', href: '/admin/documents', icon: FolderOpen, keywords: 'letters templates pdf' },
  { label: 'Marketers', href: '/admin/marketers', icon: BarChart3, keywords: 'team performance' },
  { label: 'Alumni', href: '/admin/alumni', icon: GraduationCap, keywords: 'graduates success stories' },
  { label: 'Staff', href: '/admin/staff', icon: Users, keywords: 'team members employees add' },
  { label: 'Reports', href: '/admin/reports', icon: BarChart3, keywords: 'analytics export' },
  { label: 'Clock in', href: '/clock-in', icon: CalendarCheck, keywords: 'attendance sign in' },
  { label: 'Settings', href: '/admin/settings', icon: Settings, keywords: 'integrations config test sms' },
]

export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) { setQuery(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 50) }
  }, [open])

  const results = useMemo(() => {
    if (!query.trim()) return COMMANDS
    const q = query.toLowerCase()
    return COMMANDS.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.sublabel?.toLowerCase().includes(q) ||
      c.keywords?.toLowerCase().includes(q)
    )
  }, [query])

  useEffect(() => { setActive(0) }, [query])

  function go(href: string) { setOpen(false); router.push(href) }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active].href) }
  }

  if (!mounted) return null

  return createPortal(
    <>
      {open && (
        <div className="fixed inset-0 z-[10001] flex items-start justify-center pt-[12vh] px-4"
          style={{ backgroundColor: 'rgba(20,20,22,0.4)', backdropFilter: 'blur(2px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-[var(--line)]">
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 border-b border-[var(--line)]" style={{ height: 56 }}>
              <Search size={18} className="text-[var(--ink-faint)] flex-shrink-0" />
              <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onInputKey}
                placeholder="Search pages and actions…"
                className="flex-1 bg-transparent text-[15px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none" />
              <kbd className="text-[10px] font-semibold text-[var(--ink-faint)] bg-[var(--line-soft)] px-1.5 py-0.5 rounded">ESC</kbd>
            </div>

            {/* Results */}
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {results.length === 0 ? (
                <div className="py-10 text-center text-sm text-[var(--ink-faint)]">No matches for "{query}"</div>
              ) : results.map((c, i) => {
                const Icon = c.icon
                return (
                  <button key={c.href} onClick={() => go(c.href)} onMouseEnter={() => setActive(i)}
                    className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left transition ${i === active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--line-soft)]'}`}>
                    <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${i === active ? 'bg-[var(--accent)] text-white' : 'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
                      <Icon size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium ${i === active ? 'text-[var(--accent)]' : 'text-[var(--ink)]'}`}>{c.label}</div>
                      {c.sublabel && <div className="text-xs text-[var(--ink-faint)]">{c.sublabel}</div>}
                    </div>
                    {i === active && <CornerDownLeft size={14} className="text-[var(--accent)] flex-shrink-0" />}
                  </button>
                )
              })}
            </div>

            <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--line)] text-[11px] text-[var(--ink-faint)]">
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1"><kbd className="bg-[var(--line-soft)] px-1 rounded">↑↓</kbd> navigate</span>
                <span className="flex items-center gap-1"><kbd className="bg-[var(--line-soft)] px-1 rounded">↵</kbd> open</span>
              </span>
              <span>Cambridge CCE</span>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  )
}

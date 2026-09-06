'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LogOut, Menu, X, ChevronDown, Search as SearchIcon, Shield, ArrowLeft,
} from 'lucide-react'

import { resolvePortals } from '@/lib/access/portals'
import { navFor, tabsFor, type NavSection } from '@/lib/nav/model'
import { ROLE_LABELS } from '@/lib/utils'
import CommandPalette from '@/components/shared/CommandPalette'
import NotificationBell from '@/components/shared/NotificationBell'
import InstallButton from '@/components/shared/InstallButton'
import { Avatar } from '@/components/ui'
import { useRailPreference } from '@/hooks/useRailPreference'
import { NAV_ICONS as ICONS } from '@/components/shared/navIcons'

/**
 * The application shell.
 *
 * ── WHAT CHANGED, AND WHY ──────────────────────────────────────────────────
 *
 * Three things were wrong with the shell rather than with its styling.
 *
 * First, it carried its own navigation catalogue — ALL_PORTALS and
 * NAV_BY_ROLE, several hundred lines of it — which had to agree with
 * PORTAL_PATHS and did not. That catalogue now lives in lib/nav/model.ts and
 * is filtered through the same predicate the proxy enforces, so this file
 * renders navigation rather than deciding it.
 *
 * Second, the desktop sidebar was hidden by default and opened as an overlay
 * that closed again on every navigation. The effect was a desktop application
 * with no standing navigation at all: every move between screens cost a click
 * to open the menu, a scan, and a click to choose. A sidebar that is always
 * there — and can be narrowed to an icon rail when the workspace matters more
 * — is what makes a product feel like a place you are working rather than a
 * series of pages you are visiting.
 *
 * Third, the breadcrumb was assembled from URL segments, so a lead detail page
 * announced itself as "Admin / Leads / 4f3c8a91-…". The title now comes from
 * the navigation model, which knows what each destination is called.
 */

type Profile = {
  id: string
  full_name: string
  role: string
  email?: string
  phone?: string
  portals?: string[] | null
}

/** `/admin/leads` is active on `/admin/leads/123`, but not on `/admin/leadsx`. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href.length > 1 && pathname.startsWith(href + '/'))
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  /* Held as the path they were opened on, so navigating closes them without
     an effect that re-renders the shell on every route change. */
  const [drawerPath, setDrawerPath] = useState<string | null>(null)
  /** A group the user expanded, remembered with the page it was expanded on
      so it does not stay open after they navigate somewhere else. */
  const [picked, setPicked] = useState<{ path: string; id: string } | null>(null)
  const [menuPath, setMenuPath] = useState<string | null>(null)

  /* ── session ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    document.documentElement.classList.add('app-shell')
    return () => document.documentElement.classList.remove('app-shell')
  }, [])

  useEffect(() => {
    let alive = true
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(s => {
        if (!alive) return
        if (!s?.valid) { router.replace('/login'); return }
        setProfile({
          id: s.userId, full_name: s.fullName, role: s.role,
          email: s.email, phone: s.phone, portals: s.portals,
        })
        setLoading(false)
      })
      .catch(() => { if (alive) router.replace('/login') })
    return () => { alive = false }
    // Re-read on navigation: access changed while someone is signed in should
    // take effect without making them log out and back in.
  }, [pathname, router])

  /* The sidebar width is a stored preference; see hooks/useRailPreference. */
  const [railed, toggleRail] = useRailPreference()

  /* ── navigation ──────────────────────────────────────────────────────── */

  const portals = useMemo(
    () => resolvePortals(profile?.role, profile?.portals ?? null),
    [profile?.role, profile?.portals]
  )
  const sections: NavSection[] = useMemo(
    () => (profile ? navFor(profile.role, portals) : []),
    [profile, portals]
  )
  const tabs = useMemo(
    () => (profile ? tabsFor(profile.role, portals) : []),
    [profile, portals]
  )

  /*
   * Which group is expanded.
   *
   * Derived from the current page rather than stored and re-synchronised by an
   * effect: the sidebar should show where you are, and an effect that writes
   * that back into state renders the whole shell twice on every navigation.
   * A group the user opens themselves takes precedence until they navigate.
   */
  const openGroup = useMemo(() => {
    if (picked && picked.path === pathname) return picked.id || null
    for (const section of sections) {
      for (const item of section.items) {
        if (item.children?.some(c => isActive(pathname, c.href))) return item.id
      }
    }
    return null
  }, [picked, pathname, sections])

  const drawerOpen = drawerPath === pathname
  const profileMenu = menuPath === pathname

  /**
   * What this page is called.
   *
   * Taken from the navigation model rather than from URL segments, so a lead
   * detail page is "Leads" and not "Admin / Leads / 4f3c8a91-…".
   */
  const pageTitle = useMemo(() => {
    let best = ''
    let bestLength = -1
    for (const section of sections) {
      for (const item of section.items) {
        for (const dest of item.children?.length ? item.children : [{ label: item.label, href: item.href }]) {
          if (isActive(pathname, dest.href) && dest.href.length > bestLength) {
            best = dest.label
            bestLength = dest.href.length
          }
        }
      }
    }
    return best
  }, [pathname, sections])

  const canGoBack = pathname.split('/').filter(Boolean).length > 2

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }, [router])

  if (loading) {
    return (
      <div className="fixed inset-0 grid place-items-center" style={{ background: 'var(--canvas)' }}>
        <div className="text-center">
          <div className="w-7 h-7 border-2 border-[var(--accent)] border-t-transparent rounded-full spin mx-auto mb-3" />
          <p className="text-[var(--ink-faint)] text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  const roleLabel = ROLE_LABELS[profile?.role || ''] || profile?.role || ''

  /* ── sidebar contents ────────────────────────────────────────────────── */

  const navList = (wide: boolean) => (
    <nav className="flex-1 overflow-y-auto py-3 px-2.5" aria-label="Sections">
      {sections.map((section, i) => (
        <div key={section.id} className={i > 0 ? 'mt-5' : ''}>
          {section.title && wide && (
            <h2 className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em]
              text-[var(--ink-faint)] select-none">
              {section.title}
            </h2>
          )}
          {section.title && !wide && i > 0 && (
            <div className="mx-3 mb-2.5 border-t border-[var(--line)]" aria-hidden="true" />
          )}

          {section.items.map(item => {
            const Icon = ICONS[item.icon]
            const open = openGroup === item.id
            const selfActive = isActive(pathname, item.href)
            const childActive = item.children?.some(c => isActive(pathname, c.href))
            const active = selfActive || childActive

            const rowClass = `w-full flex items-center rounded-xl transition-colors mb-0.5
              ${wide ? 'gap-3 px-3 py-2.5' : 'justify-center py-3'}
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
              ${active
                ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                : 'text-[var(--ink-soft)] hover:bg-[var(--line-soft)] hover:text-[var(--ink)]'}`

            if (item.children?.length) {
              return (
                <div key={item.id}>
                  <button
                    type="button"
                    onClick={() => (wide ? setPicked({ path: pathname, id: open ? '' : item.id }) : router.push(item.href))}
                    aria-expanded={wide ? open : undefined}
                    title={wide ? undefined : item.label}
                    className={rowClass}
                  >
                    <Icon size={19} className="flex-shrink-0" aria-hidden="true" />
                    {wide && (
                      <>
                        <span className="flex-1 text-left text-[14px] truncate">{item.label}</span>
                        <ChevronDown size={14} aria-hidden="true"
                          className={`opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
                      </>
                    )}
                  </button>

                  {wide && open && (
                    <div className="ml-5 pl-3 border-l border-[var(--line)] mb-1.5 space-y-0.5">
                      {item.children.map(child => (
                        <Link
                          key={child.href}
                          href={child.href}
                          aria-current={isActive(pathname, child.href) ? 'page' : undefined}
                          className={`block px-3 py-2 rounded-lg text-[13px] transition-colors
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
                            ${isActive(pathname, child.href)
                              ? 'text-[var(--accent)] font-semibold bg-[var(--accent-soft)]'
                              : 'text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--line-soft)] font-medium'}`}
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <Link key={item.id} href={item.href} title={wide ? undefined : item.label}
                aria-current={selfActive ? 'page' : undefined} className={rowClass}>
                <Icon size={19} className="flex-shrink-0" aria-hidden="true" />
                {wide && <span className="text-[14px] truncate">{item.label}</span>}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )

  const sidebar = ({ wide, inDrawer = false }: { wide: boolean; inDrawer?: boolean }) => (
    <div className="flex flex-col h-full bg-[var(--paper)]">
      <div className={`flex items-center border-b border-[var(--line)] flex-shrink-0 h-[60px]
        ${wide ? 'px-4 gap-3' : 'justify-center'}`}>
        <span className="w-9 h-9 rounded-lg grid place-items-center flex-shrink-0 bg-white
          border border-[var(--line)] overflow-hidden p-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo.png" alt="" aria-hidden="true" className="w-full h-full object-contain" />
        </span>
        {wide && (
          <span className="min-w-0 flex-1">
            <span className="block font-display text-[14px] font-semibold text-[var(--ink)] truncate leading-tight">
              Cambridge
            </span>
            <span className="block text-[10.5px] text-[var(--ink-faint)] truncate">{roleLabel}</span>
          </span>
        )}
        {inDrawer && (
          <button type="button" onClick={() => setDrawerPath(null)} aria-label="Close menu"
            className="ml-auto w-10 h-10 -mr-2 grid place-items-center text-[var(--ink-faint)]
              hover:text-[var(--ink)] hover:bg-[var(--line-soft)] rounded-xl transition-colors">
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      {navList(wide)}

      <div className="border-t border-[var(--line)] p-2.5 flex-shrink-0 safe-b">
        {wide ? (
          <>
            <div className="flex items-center gap-2.5 px-2 py-1.5 mb-1.5">
              <Avatar name={profile?.full_name || ''} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-[var(--ink)] truncate">
                  {profile?.full_name}
                </span>
                <span className="block text-[10.5px] text-[var(--ink-faint)] truncate">{roleLabel}</span>
              </span>
            </div>
            <InstallButton />
            <div className="flex gap-1.5 mt-1">
              <Link href="/admin/settings/change-pin"
                className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-xl
                  text-[12px] font-medium text-[var(--ink-faint)] hover:text-[var(--ink)]
                  hover:bg-[var(--line-soft)] transition-colors">
                <Shield size={13} aria-hidden="true" /> PIN
              </Link>
              <button type="button" onClick={logout}
                className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-xl
                  text-[12px] font-medium text-[var(--ink-faint)] hover:text-[var(--danger)]
                  hover:bg-[var(--danger-soft)] transition-colors">
                <LogOut size={13} aria-hidden="true" /> Sign out
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Avatar name={profile?.full_name || ''} size="sm" />
            <button type="button" onClick={logout} aria-label="Sign out" title="Sign out"
              className="w-10 h-10 grid place-items-center text-[var(--ink-faint)]
                hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] rounded-xl transition-colors">
              <LogOut size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  )

  /* ── shell ───────────────────────────────────────────────────────────── */

  const railWidth = railed ? 68 : 260

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: 'var(--canvas)' }}>
      <CommandPalette />

      {/* Desktop: standing navigation, narrowable to a rail. Not an overlay —
          it is part of the workspace, and the page sits beside it. */}
      <aside
        className="hidden lg:flex flex-col flex-shrink-0 border-r border-[var(--line)]
          transition-[width] duration-200 ease-out"
        style={{ width: railWidth }}
      >
        {sidebar({ wide: !railed })}
      </aside>

      {/* Phone and tablet: the same navigation as a drawer, opened from More. */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button type="button" aria-label="Close menu" onClick={() => setDrawerPath(null)}
            className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-2xl">
            {sidebar({ wide: true, inDrawer: true })}
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <header className="flex-shrink-0 bg-[var(--paper)] border-b border-[var(--line)]
          flex items-center gap-2 px-3 sm:px-5 h-[60px] safe-t">

          <button type="button" onClick={() => setDrawerPath(pathname)} aria-label="Open menu"
            className="lg:hidden w-10 h-10 grid place-items-center text-[var(--ink-soft)]
              hover:text-[var(--ink)] hover:bg-[var(--line-soft)] rounded-xl transition-colors">
            <Menu size={19} aria-hidden="true" />
          </button>

          <button type="button" onClick={toggleRail}
            aria-label={railed ? 'Widen the sidebar' : 'Narrow the sidebar'}
            className="hidden lg:grid w-10 h-10 place-items-center text-[var(--ink-soft)]
              hover:text-[var(--ink)] hover:bg-[var(--line-soft)] rounded-xl transition-colors">
            <Menu size={19} aria-hidden="true" />
          </button>

          {canGoBack && (
            <button type="button" onClick={() => router.back()}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-2.5 rounded-xl text-[13.5px]
                font-medium text-[var(--ink-soft)] hover:text-[var(--ink)]
                hover:bg-[var(--line-soft)] transition-colors flex-shrink-0">
              <ArrowLeft size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Back</span>
            </button>
          )}

          {/* The page's name, from the navigation model — not from URL
              segments, which produced "Admin / Leads / 4f3c8a91-…". */}
          <span className="min-w-0 flex-1 font-display text-[15px] font-semibold text-[var(--ink)] truncate">
            {pageTitle}
          </span>

          <button
            type="button"
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
            className="hidden sm:inline-flex items-center gap-2 h-10 pl-3 pr-2 rounded-xl
              border border-[var(--line)] text-[var(--ink-faint)] hover:border-[var(--ink-faint)]
              hover:text-[var(--ink-soft)] transition-colors flex-shrink-0"
          >
            <SearchIcon size={15} aria-hidden="true" />
            <span className="text-[13px]">Search</span>
            <kbd className="text-[10px] font-semibold bg-[var(--line-soft)] px-1.5 py-0.5 rounded">⌘K</kbd>
          </button>

          <NotificationBell userId={profile?.id || null} />

          {/* A real menu rather than a decorative circle: signing out was
              previously only reachable from the sidebar footer, which on a
              phone meant opening the drawer and scrolling past every section. */}
          <div className="relative flex-shrink-0">
            <button type="button" onClick={() => setMenuPath(p => (p ? null : pathname))}
              aria-haspopup="menu" aria-expanded={profileMenu}
              aria-label={`Account: ${profile?.full_name || ''}`}
              className="flex items-center gap-2 h-10 pl-1 pr-1 sm:pr-2 rounded-xl
                hover:bg-[var(--line-soft)] transition-colors">
              <Avatar name={profile?.full_name || ''} size="sm" />
              <span className="hidden md:block text-[13px] font-semibold text-[var(--ink)] max-w-[120px] truncate">
                {profile?.full_name?.split(' ')[0]}
              </span>
            </button>

            {profileMenu && (
              <>
                <button type="button" aria-hidden="true" tabIndex={-1}
                  onClick={() => setMenuPath(null)} className="fixed inset-0 z-30 cursor-default" />
                <div role="menu" aria-label="Account"
                  className="absolute right-0 mt-1 z-40 w-[230px] rounded-xl bg-[var(--paper)]
                    border border-[var(--line)] shadow-lg py-1">
                  <div className="px-3.5 py-2.5 border-b border-[var(--line)]">
                    <div className="text-[13.5px] font-semibold text-[var(--ink)] truncate">
                      {profile?.full_name}
                    </div>
                    <div className="text-[12px] text-[var(--ink-faint)] truncate">{roleLabel}</div>
                  </div>
                  <Link role="menuitem" href="/admin/settings/change-pin"
                    className="flex items-center gap-2.5 px-3.5 py-3 text-[13.5px] text-[var(--ink)]
                      hover:bg-[var(--line-soft)] transition-colors">
                    <Shield size={15} aria-hidden="true" /> Change PIN
                  </Link>
                  <button role="menuitem" type="button" onClick={logout}
                    className="w-full flex items-center gap-2.5 px-3.5 py-3 text-[13.5px]
                      text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-colors">
                    <LogOut size={15} aria-hidden="true" /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden" style={{ background: 'var(--canvas)' }}>
          <div className="w-full px-4 py-5 sm:px-7 sm:py-7 lg:px-10 lg:py-9
            pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-9 mx-auto max-w-[1500px]">
            {children}
          </div>
        </main>

        {/* Bottom navigation. Four destinations chosen from what this person
            actually holds, plus More for everything else. Hidden from lg up,
            where the sidebar is standing. */}
        <nav aria-label="Main"
          className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[var(--line)]
            bg-[var(--paper)]/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
          <div className="grid mx-auto max-w-lg"
            style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
            {tabs.map(tab => {
              const Icon = ICONS[tab.icon]
              const active = isActive(pathname, tab.href)
              return (
                <Link key={tab.key} href={tab.href} aria-current={active ? 'page' : undefined}
                  className={`flex flex-col items-center justify-center gap-1 min-h-[58px] py-2
                    transition-colors focus-visible:outline-none focus-visible:ring-2
                    focus-visible:ring-inset focus-visible:ring-[var(--accent)]
                    ${active ? 'text-[var(--accent)]' : 'text-[var(--ink-faint)]'}`}>
                  <Icon size={21} className="flex-shrink-0" aria-hidden="true" />
                  <span className="text-[10.5px] font-semibold leading-none truncate max-w-full px-0.5">
                    {tab.label}
                  </span>
                </Link>
              )
            })}
            <button type="button" onClick={() => setDrawerPath(pathname)} aria-label="More sections"
              className="flex flex-col items-center justify-center gap-1 min-h-[58px] py-2
                text-[var(--ink-faint)] transition-colors focus-visible:outline-none
                focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]">
              <Menu size={21} className="flex-shrink-0" aria-hidden="true" />
              <span className="text-[10.5px] font-semibold leading-none">More</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  )
}

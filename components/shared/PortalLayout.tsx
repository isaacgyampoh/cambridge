'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { BRAND } from '@/lib/brand'
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

/** How long a cached session is trusted before it is checked again. */
const SESSION_REVALIDATE_MS = 5 * 60 * 1000

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

  /*
   * The session, fetched once — not on every navigation.
   *
   * This ran on every pathname change, so each click cost a blocking round
   * trip to /api/auth/me before the navigation could render, ON TOP of the
   * session lookup the proxy already performs for the same request. Two
   * session checks per click, one of them holding up the paint.
   *
   * The reason it re-read was real: access changed while somebody is signed in
   * should take effect without making them sign out. That is preserved, but at
   * a sensible cadence — when the tab regains focus, and at most once every
   * five minutes — rather than on every click.
   */
  const lastChecked = useRef(0)

  useEffect(() => {
    let alive = true

    const read = async () => {
      lastChecked.current = Date.now()
      try {
        const res = await fetch('/api/auth/me')
        const s = res.ok ? await res.json() : null
        if (!alive) return
        if (!s?.valid) { router.replace('/login'); return }
        setProfile({
          id: s.userId, full_name: s.fullName, role: s.role,
          email: s.email, phone: s.phone, portals: s.portals,
        })
        setLoading(false)
      } catch {
        if (alive) router.replace('/login')
      }
    }

    // First paint, or a stale session.
    if (!lastChecked.current || Date.now() - lastChecked.current > SESSION_REVALIDATE_MS) {
      void read()
    }

    // Coming back to the tab is the moment a change is most likely to matter.
    const onFocus = () => {
      if (Date.now() - lastChecked.current > SESSION_REVALIDATE_MS) void read()
    }
    window.addEventListener('focus', onFocus)

    return () => { alive = false; window.removeEventListener('focus', onFocus) }
  }, [router])

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
            <h2 className="px-3 pb-1.5 t-overline select-none">{section.title}</h2>
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

            const rowClass = `w-full flex items-center rounded-lg transition-colors mb-px
              ${wide ? 'gap-2.5 px-3 py-2' : 'justify-center py-2.5'}
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
              ${active
                ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-medium'
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
                    <Icon size={17} className="flex-shrink-0" aria-hidden="true" />
                    {wide && (
                      <>
                        <span className="flex-1 text-left text-[13px] truncate">{item.label}</span>
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
                          className={`block px-3 py-1.5 rounded-lg text-[13px] transition-colors
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
                            ${isActive(pathname, child.href)
                              ? 'text-[var(--accent)] font-medium'
                              : 'text-[var(--ink-faint)] hover:text-[var(--ink)]'}`}
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
                <Icon size={17} className="flex-shrink-0" aria-hidden="true" />
                {wide && <span className="text-[13px] truncate">{item.label}</span>}
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
        <span className="w-9 h-9 rounded-lg grid place-items-center flex-shrink-0 bg-[var(--paper)]
          border border-[var(--line)] overflow-hidden p-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo.png" alt="" aria-hidden="true" className="w-full h-full object-contain" />
        </span>
        {wide && (
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-[var(--ink)] truncate leading-tight">
              {BRAND.shortName}
            </span>
            <span className="block t-meta truncate">{roleLabel}</span>
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
                <span className="block text-[12px] font-semibold text-[var(--ink)] truncate">
                  {profile?.full_name}
                </span>
                <span className="block text-[11px] text-[var(--ink-faint)] truncate">{roleLabel}</span>
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

      {/*
        Phone and tablet: "More", as a sheet that rises from the bottom.

        It used to be a drawer sliding in from the LEFT. That is the hamburger
        pattern, and it was wrong for how this is opened: More is the fourth
        item in the bottom tab bar, so the thing it opens appeared at the
        opposite corner of the screen from the thumb that asked for it.

        A sheet rises from where it was tapped, is dismissed by the same
        gesture, and stops short of the top so the page behind stays visible —
        which is what tells you this is a layer over the screen you were on
        rather than a new one.
      */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true"
          aria-label="All sections">
          <button type="button" aria-label="Close menu" onClick={() => setDrawerPath(null)}
            className="absolute inset-0 bg-black/40" />

          <div className="absolute inset-x-0 bottom-0 max-h-[86vh] flex flex-col
            rounded-t-3xl overflow-hidden bg-[var(--paper)]
            shadow-[var(--shadow-overlay)] sheet-rise">
            {/* The grabber. Signals "this pulls down" before anyone tries. */}
            <div className="flex-shrink-0 pt-2.5 pb-1 grid place-items-center">
              <span aria-hidden="true"
                className="w-9 h-1 rounded-full bg-[var(--line)]" />
            </div>
            {sidebar({ wide: true, inDrawer: true })}
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/*
          One bar, two personalities.

          On a phone it is the application's navy chrome carrying the brand and
          the screen name — the thing that makes it read as an app rather than
          a website. From lg up it becomes a quiet white strip, because the
          sidebar is already carrying the identity and a second navy band would
          just be decoration.
        */}
        <header className="flex-shrink-0 flex items-center gap-2 px-3 sm:px-5
          h-[56px] lg:h-[60px] bg-[var(--brand)] lg:bg-[var(--paper)]
          border-b border-transparent lg:border-[var(--line)] safe-t">

          {canGoBack ? (
            <button type="button" onClick={() => router.back()} aria-label="Back"
              className="w-10 h-10 grid place-items-center rounded-lg flex-shrink-0
                text-white/90 lg:text-[var(--ink-soft)]
                hover:bg-white/10 lg:hover:bg-[var(--line-soft)] transition-colors">
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" onClick={() => setDrawerPath(pathname)} aria-label="Open menu"
              className="lg:hidden w-10 h-10 grid place-items-center rounded-lg flex-shrink-0
                text-white/90 hover:bg-white/10 transition-colors">
              <Menu size={20} aria-hidden="true" />
            </button>
          )}

          <button type="button" onClick={toggleRail}
            aria-label={railed ? 'Widen the sidebar' : 'Narrow the sidebar'}
            className="hidden lg:grid w-10 h-10 place-items-center rounded-lg
              text-[var(--ink-soft)] hover:bg-[var(--line-soft)] transition-colors">
            <Menu size={19} aria-hidden="true" />
          </button>

          <span className="min-w-0 flex-1 truncate text-[15px] lg:text-[14px] font-semibold
            lg:font-medium text-white lg:text-[var(--ink)]">
            {pageTitle || BRAND.shortName}
          </span>

          <button
            type="button"
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
            className="hidden sm:inline-flex items-center gap-2 h-11 sm:h-9 pl-3 pr-2 rounded-lg flex-shrink-0 border border-white/15 lg:border-[var(--line)] text-white/70 lg:text-[var(--ink-faint)] hover:bg-white/10 lg:hover:bg-[var(--line-soft)] transition-colors"
          >
            <SearchIcon size={15} aria-hidden="true" />
            <span className="text-[13px]">Search</span>
            <kbd className="text-[10px] font-semibold px-1.5 py-0.5 rounded
              bg-white/10 lg:bg-[var(--line-soft)]">⌘K</kbd>
          </button>

          <div className="text-white lg:text-[var(--ink-soft)] flex-shrink-0">
            <NotificationBell userId={profile?.id || null} />
          </div>

          <div className="relative flex-shrink-0">
            <button type="button" onClick={() => setMenuPath(p => (p ? null : pathname))}
              aria-haspopup="menu" aria-expanded={profileMenu}
              aria-label={`Account: ${profile?.full_name || ''}`}
              className="flex items-center gap-2 h-10 pl-1 pr-1 sm:pr-2 rounded-lg
                hover:bg-white/10 lg:hover:bg-[var(--line-soft)] transition-colors">
              <Avatar name={profile?.full_name || ''} size="sm" />
              <span className="hidden md:block text-[13px] font-medium max-w-[110px] truncate
                text-white lg:text-[var(--ink)]">
                {profile?.full_name?.split(' ')[0]}
              </span>
            </button>

            {profileMenu && (
              <>
                <button type="button" aria-hidden="true" tabIndex={-1}
                  onClick={() => setMenuPath(null)} className="fixed inset-0 z-30 cursor-default" />
                <div role="menu" aria-label="Account"
                  className="absolute right-0 mt-1 z-40 w-[230px] rounded-2xl bg-[var(--paper)]
                    border border-[var(--line)] shadow-[var(--shadow-overlay)] py-1 sheet-in">
                  <div className="px-3.5 py-2.5 border-b border-[var(--line-soft)]">
                    <div className="text-[13px] font-semibold text-[var(--ink)] truncate">
                      {profile?.full_name}
                    </div>
                    <div className="text-[12px] text-[var(--ink-faint)] truncate">{roleLabel}</div>
                  </div>
                  <Link role="menuitem" href="/admin/settings/change-pin"
                    className="flex items-center gap-2.5 px-3.5 py-3 text-[13px] text-[var(--ink)]
                      hover:bg-[var(--line-soft)] transition-colors">
                    <Shield size={15} aria-hidden="true" /> Change PIN
                  </Link>
                  <button role="menuitem" type="button" onClick={logout}
                    className="w-full flex items-center gap-2.5 px-3.5 py-3 text-[13px]
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
            has-tabbar lg:pb-9 mx-auto max-w-[1500px]">
            {children}
          </div>
        </main>

        {/* Bottom navigation. Four destinations chosen from what this person
            actually holds, plus More for everything else. Hidden from lg up,
            where the sidebar is standing. */}
        <nav aria-label="Main"
          className="lg:hidden fixed bottom-0 inset-x-0 z-40 tab-bar">
          <div className="grid mx-auto max-w-lg"
            style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
            {tabs.map(tab => {
              const Icon = ICONS[tab.icon]
              const active = isActive(pathname, tab.href)
              return (
                <Link key={tab.key} href={tab.href} aria-current={active ? 'page' : undefined}
                  className={`flex flex-col items-center justify-center gap-1 min-h-[60px] py-2
                    transition-colors focus-visible:outline-none focus-visible:ring-2
                    focus-visible:ring-inset focus-visible:ring-white/40
                    ${active ? 'text-white' : 'text-white/45'}`}>
                  <Icon size={21} className="flex-shrink-0" aria-hidden="true" />
                  <span className="text-[11px] font-semibold leading-none truncate max-w-full px-0.5">
                    {tab.label}
                  </span>
                </Link>
              )
            })}
            <button type="button" onClick={() => setDrawerPath(pathname)} aria-label="More sections"
              className="flex flex-col items-center justify-center gap-1 min-h-[60px] py-2
                text-white/45 transition-colors focus-visible:outline-none
                focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40">
              <Menu size={21} className="flex-shrink-0" aria-hidden="true" />
              <span className="text-[11px] font-semibold leading-none">More</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  )
}

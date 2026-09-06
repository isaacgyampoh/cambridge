'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, TrendingUp, UserCheck, Bell, Menu } from 'lucide-react'
import { ROLE_HOME } from '@/lib/access/portals'

/**
 * Thumb-reachable navigation for staff on a phone.
 *
 * The portal's only navigation was a drawer behind a hamburger: every move
 * between screens cost a tap to open it, a scan of thirty-odd entries, and a
 * tap to choose. That is a desktop sidebar on a phone, not mobile navigation.
 *
 * Five destinations, fixed to the bottom where the thumb already is, with the
 * drawer kept as "More" for everything else. Which five depends on what the
 * person actually has: a marketer gets their leads, an accountant gets
 * admissions, and neither is shown a tab that would only refuse them.
 *
 * Desktop is untouched — this is hidden from `lg` up, where the sidebar is the
 * right shape and the pointer makes its density an advantage.
 */

type Tab = {
  key: string
  label: string
  href: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  /** Shown only if the person holds one of these portals. */
  needs?: string[]
}

/**
 * Labels are short enough to survive a 320px screen: five tabs across leaves
 * about 60px each, so "Registrations" would truncate and "Reg…" helps nobody.
 */
function tabsFor(portals: string[], role: string): Tab[] {
  const has = (...ids: string[]) => ids.some(id => portals.includes(id))

  const all: Tab[] = [
    { key: 'home', label: 'Home', href: ROLE_HOME[role] || '/admin', icon: Home },
    { key: 'leads', label: 'Leads', href: portals.includes('leads') ? '/admin/leads' : '/marketer/leads',
      icon: TrendingUp, needs: ['leads', 'my_leads', 'pm_leads'] },
    { key: 'admissions', label: 'Admissions', href: '/admin/admissions',
      icon: UserCheck, needs: ['admissions'] },
    { key: 'messages', label: 'Inbox', href: '/messages',
      icon: Bell, needs: ['messages', 'conversations'] },
  ]

  const visible = all.filter(t => !t.needs || has(...t.needs))

  // "More" opens the full drawer, so nothing is ever unreachable from here.
  return [...visible.slice(0, 4), { key: 'more', label: 'More', href: '#more', icon: Menu }]
}

export default function MobileTabBar({
  portals, role, onOpenMore,
}: {
  portals: string[]
  role: string
  onOpenMore: () => void
}) {
  const pathname = usePathname()
  const tabs = tabsFor(portals, role)

  const isActive = (href: string) =>
    href !== '#more' && (pathname === href || pathname.startsWith(href + '/'))

  return (
    <nav
      aria-label="Main"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[var(--line)]
        bg-[var(--paper)]/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
    >
      <div
        className="grid mx-auto max-w-lg"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map(tab => {
          const Icon = tab.icon
          const active = isActive(tab.href)

          const inner = (
            <>
              <Icon size={21} className="shrink-0" aria-hidden="true" />
              <span className="text-[10.5px] font-semibold leading-none truncate max-w-full px-0.5">
                {tab.label}
              </span>
            </>
          )

          // 58px clears the 44px minimum touch target with room for the label.
          const cls = `flex flex-col items-center justify-center gap-1 min-h-[58px] py-2
            transition-colors focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-inset focus-visible:ring-[var(--accent)]
            ${active ? 'text-[var(--accent)]' : 'text-[var(--ink-faint)] hover:text-[var(--ink-soft)]'}`

          if (tab.key === 'more') {
            return (
              <button key={tab.key} onClick={onOpenMore} className={cls} aria-label="More sections">
                {inner}
              </button>
            )
          }

          return (
            <Link key={tab.key} href={tab.href} className={cls}
              aria-current={active ? 'page' : undefined}>
              {inner}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

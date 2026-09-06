import { canReachPage } from '../access/pageAccess.ts'
import { ROLE_HOME } from '../access/portals.ts'

/**
 * The navigation model.
 *
 * ── WHY THIS REPLACES THREE CATALOGUES ─────────────────────────────────────
 *
 * Navigation was defined in three places that had to agree and did not:
 * ALL_PORTALS and NAV_BY_ROLE inside PortalLayout.tsx, tabsFor() inside
 * MobileTabBar.tsx, and PORTAL_PATHS in lib/access/portals.ts. The first two
 * decided what to SHOW; only the third decided what could be OPENED.
 *
 * The consequence was links that bounce. `/admin/sequences` sat under
 * "Messaging & AI" but belonged to no portal, so anyone but a super admin who
 * tapped it was redirected to their home page with no explanation — which
 * reads as a broken application rather than as a permission boundary.
 *
 * Here there is one catalogue, and `navFor` filters it through the same
 * `canReachPage` the proxy enforces. A destination that would be refused
 * cannot be rendered. tests/nav.test.ts asserts that for every role.
 *
 * Pure: no React, no icons, no styling. The shell maps `icon` onto a
 * component, which keeps this testable without a DOM.
 */

/** Icon names, resolved to components by the shell. Kept as strings so this
 *  module stays free of JSX and can be unit tested. */
export type IconName =
  | 'home' | 'leads' | 'admissions' | 'finance' | 'academics' | 'attendance'
  | 'documents' | 'staff' | 'messages' | 'broadcast' | 'insights' | 'reports'
  | 'settings' | 'clock' | 'links' | 'flyers' | 'prep' | 'alumni' | 'social'
  | 'ai' | 'trophy' | 'workforce' | 'import' | 'sms'

export type NavLink = {
  label: string
  href: string
  /** Shown as a badge — unread counts, items awaiting action. */
  badgeKey?: 'notifications'
}

export type NavItem = {
  id: string
  label: string
  icon: IconName
  /** Where the item itself goes. For a group, the first reachable child. */
  href: string
  children?: NavLink[]
}

export type NavSection = {
  id: string
  /** Null for the top group, which needs no heading. */
  title: string | null
  items: NavItem[]
}

/* ─────────────────────────────────────────────
   The catalogue
   ───────────────────────────────────────────── */

/**
 * Every destination in the product, once.
 *
 * `href` values here must be reachable through PORTAL_PATHS for whoever is
 * shown them. That is not a convention to remember — navFor filters on it and
 * a test asserts nothing is silently dropped.
 */
type CatalogueEntry = NavItem & { section: string }

const HOME: CatalogueEntry = {
  id: 'home', label: 'Home', icon: 'home', href: '/__home__', section: 'top',
}

const CATALOGUE: CatalogueEntry[] = [
  HOME,
  { id: 'insights', label: 'Insights', icon: 'insights', href: '/admin/insights', section: 'top' },
  { id: 'reports', label: 'Reports', icon: 'reports', href: '/reports', section: 'top' },
  { id: 'messages', label: 'Messages', icon: 'messages', href: '/messages', section: 'top' },

  /* ── Growth ── */
  { id: 'leads', label: 'Leads', icon: 'leads', href: '/admin/leads', section: 'growth', children: [
    { label: 'All leads', href: '/admin/leads' },
    { label: 'By course', href: '/admin/leads/courses' },
    { label: 'Conversions', href: '/admin/conversions' },
    { label: 'Referrals', href: '/admin/referrals' },
    { label: 'Transfer requests', href: '/admin/transfers' },
    { label: 'Add a lead', href: '/admin/leads/new' },
    { label: 'Import a list', href: '/admin/leads/import' },
  ]},
  { id: 'my_leads', label: 'My leads', icon: 'leads', href: '/marketer/leads', section: 'growth', children: [
    { label: 'My leads', href: '/marketer/leads' },
    { label: 'Follow-ups', href: '/marketer/activities' },
    { label: 'By course', href: '/admin/leads/courses' },
    { label: 'My conversions', href: '/admin/conversions' },
    { label: 'Add a lead', href: '/marketer/leads/new' },
  ]},
  { id: 'pm_leads', label: 'Lead inbox', icon: 'leads', href: '/pm/assign', section: 'growth', children: [
    { label: 'Lead inbox', href: '/pm/assign' },
    { label: 'Reports', href: '/pm/reports' },
    { label: 'Coordinator activity', href: '/pm/prep-activity' },
  ]},
  { id: 'marketers', label: 'Marketers', icon: 'trophy', href: '/admin/marketers', section: 'growth' },
  { id: 'remuneration', label: 'Remuneration', icon: 'trophy', href: '/admin/remuneration', section: 'growth' },
  { id: 'my_earnings', label: 'My earnings', icon: 'trophy', href: '/marketer/earnings', section: 'growth' },
  { id: 'my_link', label: 'My link', icon: 'links', href: '/marketer/link', section: 'growth' },
  { id: 'my_flyers', label: 'My flyers', icon: 'flyers', href: '/marketer/flyers', section: 'growth' },
  { id: 'my_links', label: 'Shared links', icon: 'links', href: '/links', section: 'growth' },

  /* ── Enrolment ── */
  { id: 'admissions', label: 'Admissions', icon: 'admissions', href: '/admin/admissions', section: 'enrolment', children: [
    { label: 'All admissions', href: '/admin/admissions' },
    { label: 'Applications', href: '/admission/process' },
    { label: 'Student records', href: '/admin/registrations' },
  ]},
  { id: 'registrations', label: 'Registrations', icon: 'admissions', href: '/finance/registrations', section: 'enrolment' },

  /* ── Finance ── */
  { id: 'finance', label: 'Finance', icon: 'finance', href: '/finance', section: 'finance', children: [
    { label: 'Payments', href: '/finance' },
    { label: 'Student fees', href: '/finance/student-fees' },
    { label: 'Class payments', href: '/finance/class-payments' },
    { label: 'Voucher requests', href: '/finance/vouchers' },
    { label: 'Registrations', href: '/finance/registrations' },
    { label: 'Reports', href: '/finance/reports' },
    { label: 'New invoice', href: '/finance/invoices/new' },
  ]},
  { id: 'my_payments', label: 'My payments', icon: 'finance', href: '/student', section: 'finance' },

  /* ── Academics ── */
  { id: 'academics', label: 'Academics', icon: 'academics', href: '/admin/academics', section: 'academics', children: [
    { label: 'Overview', href: '/admin/academics' },
    { label: 'Courses', href: '/admin/courses' },
    { label: 'Classes', href: '/admin/classes' },
    { label: 'Certificates', href: '/admin/certificates' },
  ]},
  { id: 'attendance', label: 'Attendance', icon: 'attendance', href: '/admin/attendance', section: 'academics' },
  { id: 'my_classes', label: 'My classes', icon: 'academics', href: '/trainer/classes', section: 'academics' },
  { id: 'my_attendance', label: 'Class attendance', icon: 'attendance', href: '/marketer/attendance', section: 'academics' },
  { id: 'prep', label: 'Exam prep', icon: 'prep', href: '/coordinator', section: 'academics', children: [
    { label: 'Prep tracker', href: '/coordinator' },
    { label: 'Content bank', href: '/coordinator/content' },
    { label: 'Testimonials', href: '/coordinator/testimonials' },
  ]},
  { id: 'alumni', label: 'Alumni', icon: 'alumni', href: '/admin/alumni', section: 'academics' },

  /* ── Messaging ── */
  { id: 'broadcast', label: 'Broadcast', icon: 'broadcast', href: '/admin/broadcast', section: 'messaging', children: [
    { label: 'Broadcast & links', href: '/admin/broadcast' },
    { label: 'SMS delivery', href: '/admin/sms-delivery' },
  ]},
  { id: 'wa_lines', label: 'WhatsApp lines', icon: 'broadcast', href: '/admin/whatsapp', section: 'messaging' },
  { id: 'knowledge', label: 'AI knowledge', icon: 'ai', href: '/admin/knowledge', section: 'messaging' },
  { id: 'conversations', label: 'AI conversations', icon: 'ai', href: '/admin/conversations', section: 'messaging' },
  { id: 'grp_automation', label: 'Automation', icon: 'broadcast', href: '/pm/info-sessions', section: 'messaging', children: [
    { label: 'Info sessions', href: '/pm/info-sessions' },
    { label: 'Class reminders', href: '/classes/reminders' },
    { label: 'Payment reminders', href: '/finance/reminders' },
  ]},

  /* ── Team ── */
  { id: 'staff', label: 'Staff', icon: 'staff', href: '/admin/staff', section: 'team', children: [
    { label: 'All staff', href: '/admin/staff' },
    { label: 'Staff reports', href: '/admin/reports' },
  ]},
  { id: 'workforce', label: 'Workforce', icon: 'workforce', href: '/admin/workforce', section: 'team' },
  { id: 'clock_in', label: 'Clock in', icon: 'clock', href: '/clock-in', section: 'team' },

  /* ── Content & system ── */
  { id: 'grp_socials', label: 'Social media', icon: 'social', href: '/content', section: 'system', children: [
    { label: 'Content studio', href: '/content' },
    { label: 'Competitor research', href: '/content/research' },
    { label: 'Brand kit', href: '/content/brand' },
  ]},
  { id: 'documents', label: 'Documents', icon: 'documents', href: '/admin/documents', section: 'system' },
  { id: 'settings', label: 'Settings', icon: 'settings', href: '/admin/settings', section: 'system', children: [
    { label: 'Settings', href: '/admin/settings' },
    { label: 'Automation', href: '/admin/automation' },
    { label: 'Incoming WhatsApp', href: '/admin/webhook-log' },
    { label: 'SMS delivery', href: '/admin/sms-delivery' },
  ]},
]

const SECTION_TITLES: Record<string, string | null> = {
  top: null,
  growth: 'Growth',
  enrolment: 'Enrolment',
  finance: 'Finance',
  academics: 'Academics',
  messaging: 'Messaging',
  team: 'Team',
  system: 'Content & system',
}

const SECTION_ORDER = ['top', 'growth', 'enrolment', 'finance', 'academics', 'messaging', 'team', 'system']

/* ─────────────────────────────────────────────
   Building a person's navigation
   ───────────────────────────────────────────── */

/** Drop the grouping key from a catalogue entry. */
function stripSection(entry: CatalogueEntry): NavItem {
  const { id, label, icon, href, children } = entry
  return children ? { id, label, icon, href, children } : { id, label, icon, href }
}

/** Home resolves per role — a marketer's home is not an administrator's. */
function resolveHref(href: string, role: string): string {
  return href === '/__home__' ? (ROLE_HOME[role] || '/admin') : href
}

/**
 * The navigation for one person.
 *
 * Every href is checked against canReachPage, the same predicate the proxy
 * enforces. A group whose children are all unreachable disappears entirely
 * rather than becoming a heading that leads nowhere, and a group keeps only
 * the children this person can actually open.
 */
export function navFor(role: string, portals: string[]): NavSection[] {
  const reachable = (href: string) => canReachPage(resolveHref(href, role), role, portals)

  const items = CATALOGUE.flatMap<CatalogueEntry>(entry => {
    // Home is always present: it is where an unreachable page redirects TO,
    // so a menu without it would be a dead end.
    if (entry.id === 'home') return [{ ...entry, href: resolveHref(entry.href, role) }]

    if (entry.children?.length) {
      const kids = entry.children.filter(c => reachable(c.href))
      if (!kids.length) return []
      // The group points at its first reachable child, never at a landing page
      // this person would be bounced from.
      return [{ ...entry, href: kids[0].href, children: kids }]
    }

    return reachable(entry.href) ? [entry] : []
  })

  return SECTION_ORDER
    .map(id => ({
      id,
      title: SECTION_TITLES[id],
      // `section` is how the catalogue is grouped; it is not part of the
      // item a shell renders, so it is dropped here.
      items: items.filter(i => i.section === id).map(stripSection),
    }))
    .filter(s => s.items.length > 0)
}

/** Flat list of every destination a person can reach, for search and the drawer. */
export function allDestinations(role: string, portals: string[]): NavLink[] {
  const out: NavLink[] = []
  for (const section of navFor(role, portals)) {
    for (const item of section.items) {
      if (item.children?.length) out.push(...item.children)
      else out.push({ label: item.label, href: item.href })
    }
  }
  // The same page can be reached from two groups (SMS delivery sits under both
  // Broadcast and Settings). Show it once.
  const seen = new Set<string>()
  return out.filter(link => !seen.has(link.href) && seen.add(link.href))
}

/* ─────────────────────────────────────────────
   Bottom tabs
   ───────────────────────────────────────────── */

export type Tab = { key: string; label: string; href: string; icon: IconName }

/**
 * The four destinations on the bottom bar, plus More.
 *
 * Chosen by what the person actually does rather than by a fixed list: a
 * marketer's second tab is their own leads, an accountant's is finance. A tab
 * that would be refused is never shown, because these come from the same
 * filtered catalogue as everything else.
 *
 * Labels are short enough to survive 320px, where five tabs leave about 60px
 * each. "Registrations" would truncate to something unreadable, so the label
 * is chosen to fit rather than truncated at render time.
 */
export function tabsFor(role: string, portals: string[]): Tab[] {
  const sections = navFor(role, portals)
  const items = sections.flatMap(s => s.items)
  const find = (...ids: string[]) => {
    for (const id of ids) {
      const hit = items.find(i => i.id === id)
      if (hit) return hit
    }
    return undefined
  }

  const home = find('home')
  const tabs: Tab[] = home
    ? [{ key: 'home', label: 'Home', href: home.href, icon: 'home' }]
    : []

  // Priority order: the work, then the money or the enrolment, then messages.
  const candidates: Array<{ key: string; label: string; ids: string[]; icon: IconName }> = [
    { key: 'leads', label: 'Leads', ids: ['my_leads', 'leads', 'pm_leads'], icon: 'leads' },
    { key: 'enrol', label: 'Admissions', ids: ['admissions', 'registrations'], icon: 'admissions' },
    { key: 'finance', label: 'Finance', ids: ['finance', 'my_payments'], icon: 'finance' },
    { key: 'classes', label: 'Classes', ids: ['my_classes', 'academics'], icon: 'academics' },
    { key: 'messages', label: 'Inbox', ids: ['messages'], icon: 'messages' },
  ]

  for (const c of candidates) {
    if (tabs.length >= 4) break
    const hit = find(...c.ids)
    // A tab that goes where an existing tab already goes wastes one of four
    // slots. An accountant's home IS /finance, so their Finance entry would
    // otherwise duplicate Home and cost them a destination they could use.
    if (hit && !tabs.some(t => t.href === hit.href)) {
      tabs.push({ key: c.key, label: c.label, href: hit.href, icon: c.icon })
    }
  }

  return tabs
}

/* ─────────────────────────────────────────────
   Assignable access, for the staff permission screen
   ───────────────────────────────────────────── */

export type PortalOption = { id: string; label: string; icon: IconName }

/**
 * Every portal that can be granted to a member of staff.
 *
 * The staff screen previously imported ALL_PORTALS out of PortalLayout, so
 * choosing someone's access meant reading a list that a layout component
 * happened to define. It reads the same catalogue as the navigation now, which
 * is what makes the toggles on that screen and the menu that results from them
 * describe the same thing.
 *
 * Home is excluded: it is not access, it is where you land.
 */
export function portalOptions(): PortalOption[] {
  return CATALOGUE
    .filter(e => e.id !== 'home')
    .map(({ id, label, icon }) => ({ id, label, icon }))
}

/** Look one up by id, for rendering a portal the catalogue may not list. */
export function portalOption(id: string): PortalOption | undefined {
  return portalOptions().find(p => p.id === id)
}

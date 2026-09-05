/**
 * Grouping for the staff sidebar.
 *
 * The sidebar rendered every portal a person could reach as one flat list. For
 * a super admin that is more than thirty entries with no structure — you scan
 * the whole column to find anything, and related work sits far apart:
 * Admissions above Broadcast above Attendance above Academics.
 *
 * This groups those same portals under headings that follow the actual work,
 * so the sidebar reads as a small number of areas rather than a long list.
 *
 * It is presentation only. Nothing here grants or removes access — that
 * remains lib/access/portals.ts, which the route guard also uses. A portal
 * missing from this map still appears, under "More", rather than vanishing:
 * a navigation grouping must never be able to hide a feature someone has.
 */

export type NavSection = {
  id: string
  /** Shown above the group. Kept short — it is a label, not a sentence. */
  label: string
  /** Portal ids belonging here, in the order they should appear. */
  portals: string[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    portals: ['dashboard', 'insights'],
  },
  {
    id: 'growth',
    label: 'Growth',
    portals: [
      'leads', 'my_leads', 'pm_leads', 'grp_growth',
      'my_link', 'my_flyers', 'marketers', 'remuneration', 'my_earnings',
    ],
  },
  {
    id: 'enrolment',
    label: 'Admissions',
    portals: ['admissions', 'grp_enrolment', 'registrations', 'alumni'],
  },
  {
    id: 'academic',
    label: 'Academic',
    portals: [
      'academics', 'grp_academics', 'my_classes', 'attendance',
      'my_attendance', 'prep', 'documents',
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    portals: ['finance', 'grp_finance'],
  },
  {
    id: 'communication',
    label: 'Communication',
    portals: [
      'messages', 'conversations', 'broadcast', 'my_links',
      'wa_lines', 'knowledge', 'grp_automation', 'grp_socials',
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    portals: ['reports'],
  },
  {
    id: 'administration',
    label: 'Administration',
    portals: ['staff', 'workforce', 'clock_in', 'settings'],
  },
  {
    id: 'mine',
    label: 'My portal',
    portals: ['my_payments'],
  },
]

/** Portal id → section id, built once from the table above. */
const SECTION_OF: Record<string, string> = Object.fromEntries(
  NAV_SECTIONS.flatMap(s => s.portals.map(p => [p, s.id]))
)

/** Where an unrecognised portal goes, so nothing can disappear. */
export const FALLBACK_SECTION: NavSection = { id: 'more', label: 'More', portals: [] }

export type Grouped<T> = { section: NavSection; items: T[] }

/**
 * Arrange a person's visible nav items into sections.
 *
 * Only sections with something in them are returned, and items keep the order
 * given in NAV_SECTIONS so the sidebar does not reshuffle between people.
 * Anything not in the map lands in "More".
 */
export function groupNavItems<T extends { id: string }>(items: T[]): Grouped<T>[] {
  const byId = new Map(items.map(i => [i.id, i]))
  const claimed = new Set<string>()
  const out: Grouped<T>[] = []

  for (const section of NAV_SECTIONS) {
    const found: T[] = []
    for (const portalId of section.portals) {
      const item = byId.get(portalId)
      if (item) { found.push(item); claimed.add(portalId) }
    }
    if (found.length) out.push({ section, items: found })
  }

  const leftover = items.filter(i => !claimed.has(i.id))
  if (leftover.length) out.push({ section: FALLBACK_SECTION, items: leftover })

  return out
}

/** Which section a portal belongs to. Exported for tests. */
export function sectionOf(portalId: string): string {
  return SECTION_OF[portalId] ?? FALLBACK_SECTION.id
}

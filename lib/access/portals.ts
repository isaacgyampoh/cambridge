/**
 * SINGLE SOURCE OF TRUTH for portal access control.
 *
 * Both the sidebar (PortalLayout) and the route guard (middleware) import
 * from here, so the navigation a user sees and the routes they're allowed
 * to visit can never drift apart. Add a portal once, here, and it works
 * everywhere.
 *
 *  - PORTAL_PATHS : portal id -> the URL paths it unlocks
 *  - ROLE_DEFAULTS: role -> the portals it gets by default
 *  - ROLE_HOME    : role -> where the user lands after login
 */

export const PORTAL_PATHS: Record<string, string[]> = {
  dashboard:   ['/admin', '/pm', '/marketer', '/admission', '/finance', '/receptionist', '/trainer', '/student', '/coordinator'],
  insights:    ['/admin/insights'],
  leads:       ['/admin/leads', '/admin/conversions', '/admin/transfers', '/admin/referrals'],
  my_leads:    ['/marketer', '/marketer/leads', '/admin/conversions', '/admin/leads/courses', '/admin/leads/course'],
  my_link:     ['/marketer/link'],
  my_flyers:   ['/marketer/flyers'],
  reports:     ['/reports'],
  pm_leads:    ['/pm', '/pm/assign'],
  grp_automation: ['/pm/info-sessions', '/classes/reminders', '/finance/reminders'],
  grp_socials: ['/content'],
  admissions:  ['/admin/admissions', '/admission', '/admission/process', '/admin/registrations'],
  finance:     ['/admin/finance', '/finance'],
  broadcast:   ['/admin/broadcast', '/admin/links'],
  attendance:  ['/admin/attendance'],
  academics:   ['/admin/academics', '/admin/courses', '/admin/classes', '/admin/certificates', '/coordinator'],
  documents:   ['/admin/documents'],
  marketers:   ['/admin/marketers'],
  alumni:      ['/admin/alumni'],
  staff:       ['/admin/staff', '/admin/reports'],
  my_classes:  ['/trainer', '/trainer/classes'],
  my_payments: ['/student'],
  workforce:   ['/admin/workforce'],
  wa_lines:    ['/admin/whatsapp'],
  knowledge:   ['/admin/knowledge'],
  conversations: ['/admin/conversations'],
  remuneration: ['/admin/remuneration'],
  my_earnings: ['/marketer/earnings'],
  registrations: ['/finance/registrations'],
  clock_in:    ['/clock-in'],
  messages:    ['/messages'],
  my_links:    ['/links'],
  my_attendance: ['/marketer/attendance'],
  prep:        ['/coordinator'],
  settings:    ['/admin/settings'],
}

export const ROLE_DEFAULTS: Record<string, string[]> = {
  super_admin:       ['messages','dashboard','insights','reports','grp_automation','registrations','leads','admissions','finance','broadcast','attendance','academics','documents','marketers','alumni','staff','workforce','wa_lines','knowledge','conversations','remuneration','clock_in','settings','grp_socials'],
  project_manager:   ['dashboard','reports','grp_automation','pm_leads','leads','my_leads','my_earnings','admissions','my_links','clock_in','messages'],
  marketing_officer: ['dashboard','my_leads','my_earnings','my_link','my_flyers','reports','my_attendance','clock_in','messages'],
  admissions_officer:['dashboard','admissions','leads','my_leads','my_earnings','my_links','clock_in','messages'],
  accountant:        ['dashboard','finance','grp_automation','registrations','leads','my_leads','my_earnings','my_links','clock_in','messages'],
  trainer:           ['dashboard','my_classes','attendance','my_leads','my_earnings','my_links','clock_in','messages'],
  exam_coordinator:  ['prep','my_leads','my_earnings','my_links','clock_in','messages'],
  content_manager:   ['dashboard','grp_socials','my_leads','my_earnings','my_links','clock_in','messages'],
  student:           ['dashboard','my_payments'],
}

export const ROLE_HOME: Record<string, string> = {
  super_admin: '/admin', project_manager: '/pm', marketing_officer: '/marketer', content_manager: '/content',
  admissions_officer: '/admission', accountant: '/finance',
  trainer: '/trainer', exam_coordinator: '/coordinator', student: '/student',
}

/**
 * Resolve the portals a user can access: role defaults merged with any
 * custom portals saved on their profile. Merging (not replacing) means a
 * portal added to a role later automatically reaches existing users.
 */
export function resolvePortals(role: string | undefined, savedPortals?: string[] | null): string[] {
  const defaults = ROLE_DEFAULTS[role || ''] || ['dashboard']
  const saved = savedPortals?.length ? savedPortals : []
  return Array.from(new Set([...defaults, ...saved]))
}

/** All URL paths a user may visit, derived from their resolved portals. */
export function allowedPathsFor(role: string | undefined, savedPortals?: string[] | null): string[] {
  const paths = resolvePortals(role, savedPortals).flatMap(pid => {
    // Automation sub-pages are department-scoped, not shared by everyone who
    // has the Automation group. Grant only the pages this role actually owns.
    if (pid === 'grp_automation') {
      const p: string[] = []
      if (['super_admin', 'project_manager'].includes(role || '')) p.push('/pm/info-sessions')
      if (['super_admin', 'project_manager', 'accountant'].includes(role || '')) p.push('/classes/reminders')
      if (['super_admin', 'accountant'].includes(role || '')) p.push('/finance/reminders')
      return p
    }
    return PORTAL_PATHS[pid] || []
  })
  return paths
}

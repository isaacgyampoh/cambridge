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

/**
 * Landing pages, matched EXACTLY — never as a prefix.
 *
 * ── WHY THIS IS SEPARATE ───────────────────────────────────────────────────
 *
 * These nine paths were entries in PORTAL_PATHS under the `dashboard` portal,
 * which every role holds. Page access matches by prefix:
 *
 *     pathname === p || pathname.startsWith(p + '/')
 *
 * so listing '/admin' did not grant the admin home page. It granted every
 * page beneath it. A student — whose only portals are `dashboard` and
 * `my_payments` — could open /admin/settings, /admin/staff, /admin/finance
 * and /admin/remuneration. So could a trainer, and so could a marketing
 * officer.
 *
 * The data on those screens is fetched through /api, which IS scoped per
 * portal, so the tables came back empty or refused. But the screens
 * themselves rendered, along with their controls and structure — and any
 * future page that reads its own data server-side would have leaked outright.
 *
 * A landing page is one page. It is matched as one page.
 */
export const PORTAL_EXACT_PATHS: Record<string, string[]> = {
  dashboard: [
    '/admin', '/pm', '/marketer', '/admission', '/finance',
    '/trainer', '/student', '/coordinator',
  ],
  /*
   * The front desk, behind its own portal.
   *
   * /receptionist was listed under `dashboard` — a portal EVERY role holds —
   * so any signed-in person, a student included, could open the front-desk
   * screen and its send-reminders controls. It is a job, so it needs a portal
   * of its own, and the receptionist role is the one that holds it.
   */
  reminders: ['/receptionist'],
}

export const PORTAL_PATHS: Record<string, string[]> = {
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
  /*
   * /admin/sequences was in the navigation catalogue and in no portal at all,
   * so the page existed and nobody could open it — the route guard derives
   * access from portals, and no portal listed it. Nurture sequences are
   * automated outbound messaging, which is what this portal already covers.
   */
  broadcast:   ['/admin/broadcast', '/admin/links', '/admin/sms-delivery', '/admin/sequences'],
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
  prep:        ['/coordinator'],  settings:    ['/admin/settings', '/admin/automation', '/admin/webhook-log', '/admin/sms-delivery'],
}

export const ROLE_DEFAULTS: Record<string, string[]> = {
  super_admin:       ['messages','dashboard','insights','reports','grp_automation','registrations','leads','admissions','finance','broadcast','attendance','academics','documents','marketers','alumni','staff','workforce','wa_lines','knowledge','conversations','remuneration','clock_in','settings','grp_socials'],
  administrator:     ['messages','dashboard','insights','reports','grp_automation','registrations','leads','admissions','finance','broadcast','attendance','academics','documents','marketers','alumni','staff','knowledge','conversations','clock_in','grp_socials'],
  project_manager:   ['dashboard','reports','documents','grp_automation','pm_leads','leads','my_leads','my_earnings','admissions','academics','my_links','clock_in','messages'],
  marketing_officer: ['dashboard','my_leads','my_earnings','my_link','my_flyers','reports','my_attendance','clock_in','messages'],
  admissions_officer:['dashboard','admissions','leads','my_leads','my_earnings','my_links','clock_in','messages'],
  accountant:        ['dashboard','finance','grp_automation','registrations','leads','my_leads','my_earnings','my_links','clock_in','messages'],
  trainer:           ['dashboard','my_classes','attendance','my_leads','my_earnings','documents','my_links','clock_in','messages'],
  exam_coordinator:  ['documents','prep','my_leads','my_earnings','my_links','clock_in','messages'],
  content_manager:   ['dashboard','grp_socials','my_leads','my_earnings','my_links','clock_in','messages'],
  /*
   * Also restored: with no entry here a receptionist was granted no portals at
   * all, so even their own screen was closed to them.
   */
  /*
   * Their own screen, clocking in, and messages. Deliberately NOT `attendance`
   * — that grants /admin/attendance, which is the monitoring dashboard rather
   * than the front desk, and tests/privilegeEscalation declares that a
   * receptionist reaches no administrative page. A centre that wants one of
   * them watching the register can grant it as a duty instead of every
   * receptionist getting it by default.
   */
  receptionist:      ['dashboard','reminders','clock_in','messages'],
  student:           ['dashboard','my_payments'],
}

/**
 * DUTIES — extra responsibilities layered on top of a primary role during
 * onboarding (checkboxes). Each duty grants the portals a person needs to do
 * that job, added to their role defaults. This is how one person can be, say,
 * Accountant + Admissions + Marketing at once.
 */
export const DUTIES: Record<string, { label: string; portals: string[] }> = {
  marketing:  { label: 'Marketing (works leads)', portals: ['my_leads', 'my_link', 'my_flyers', 'reports'] },
  finance:    { label: 'Finance', portals: ['finance', 'registrations'] },
  admissions: { label: 'Admissions', portals: ['admissions'] },
  content:    { label: 'Social media / content', portals: ['grp_socials'] },
  automation: { label: 'Automation & broadcasts', portals: ['grp_automation', 'broadcast'] },
}

export const ROLE_HOME: Record<string, string> = {
  super_admin: '/admin', administrator: '/admin', project_manager: '/pm', marketing_officer: '/marketer', content_manager: '/content',
  admissions_officer: '/admission', accountant: '/finance',
  trainer: '/trainer', exam_coordinator: '/coordinator', student: '/student',
  /*
   * Restored. `receptionist` is still a role people are given — it is in
   * UserRole and in ROLE_LABELS, so the staff screen offers it — but it had
   * no landing page here, so `ROLE_HOME[role] || '/admin'` sent a receptionist
   * to /admin, which they cannot open. They were locked out of the product.
   */
  receptionist: '/receptionist',
}

/**
 * Resolve the portals a user can access: role defaults merged with any
 * custom portals saved on their profile. Merging (not replacing) means a
 * portal added to a role later automatically reaches existing users.
 */
export function resolvePortals(role: string | undefined, savedPortals?: string[] | null): string[] {
  // If access has been chosen explicitly for this person, that IS their access
  // — it is not merged with role defaults, otherwise nothing could ever be
  // taken away. Role defaults only apply when nothing has been chosen yet.
  if (savedPortals?.length) {
    return Array.from(new Set(['dashboard', ...savedPortals]))
  }
  return ROLE_DEFAULTS[role || ''] || ['dashboard']
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

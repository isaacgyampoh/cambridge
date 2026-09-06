import { PORTAL_PATHS, PORTAL_EXACT_PATHS } from './portals.ts'

/**
 * Whether a signed-in user may open a page.
 *
 * ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────
 *
 * This rule lived inside proxy.ts, so navigation could not consult it. The
 * sidebar therefore decided independently what to show, from a separate
 * catalogue kept in a component file — and the two drifted, as two copies of
 * a rule always do. `/admin/sequences` appeared under "Messaging & AI" while
 * belonging to no portal's path list, so anyone but a super admin who clicked
 * it was bounced back to their home page with no explanation.
 *
 * Being redirected away from a link the application itself just offered is a
 * particular kind of bad: the user cannot tell whether they lack permission,
 * whether the page is broken, or whether they mis-tapped.
 *
 * Now there is one predicate. proxy.ts enforces it and lib/nav/model.ts builds
 * the menu from it, so a link that would be refused cannot be rendered.
 */

/**
 * Pages every signed-in member of staff may open, whatever their portals.
 *
 * Kept identical to the list proxy.ts applied before this was extracted.
 */
export const ALWAYS_ALLOWED_PAGES = [
  '/clock-in', '/reports', '/finance/reminders',
  // Notifications are the person's own records, scoped by user_id in the data
  // policy. There is no portal that could sensibly gate them: a notification
  // is addressed to you, so being signed in is the whole requirement.
  '/notifications',
]

/** `/admin/leads` grants `/admin/leads/import`, but never `/admin/leadsomething`. */
function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

/** Every path prefix these portals unlock, including the universal ones. */
export function allowedPaths(portals: string[]): string[] {
  return [
    ...ALWAYS_ALLOWED_PAGES,
    ...portals.flatMap(id => PORTAL_PATHS[id] || []),
  ]
}

/** Landing pages these portals unlock, granted as single pages only. */
export function allowedExactPaths(portals: string[]): string[] {
  return portals.flatMap(id => PORTAL_EXACT_PATHS[id] || [])
}

/**
 * Can this user open this page?
 *
 * Super admin passes everything, matching the proxy and the role guard.
 */
export function canReachPage(
  pathname: string,
  role: string | undefined,
  portals: string[]
): boolean {
  if (role === 'super_admin') return true
  // A landing page grants itself, never its subtree. See PORTAL_EXACT_PATHS.
  if (allowedExactPaths(portals).includes(pathname)) return true
  return allowedPaths(portals).some(p => matches(pathname, p))
}

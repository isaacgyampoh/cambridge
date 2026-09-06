/**
 * Which portals unlock which API paths.
 *
 * The route guard previously granted a single hard-coded list of about
 * forty-five /api prefixes to EVERY signed-in user before their own portals
 * were considered — so a student's or a trainer's session passed the guard for
 * /api/admin, /api/finance, /api/remuneration and /api/registrations alike.
 * Protection then rested entirely on each route re-checking the role, and
 * fifteen of them did not.
 *
 * This maps API prefixes to the portals that should reach them, so a person's
 * API access is derived from the same portal list as their navigation.
 *
 * IMPORTANT: this is the coarse first pass, not the whole story. The Next.js
 * Proxy runs before routing and can be deployed to the CDN edge, so it must
 * never be the only check — every sensitive handler calls requireSession()
 * with its own permission. Defence in depth, in that order.
 */

/** Endpoints any signed-in user may reach — self-service and shared lookups. */
export const SHARED_API_PATHS: string[] = [
  '/api/auth',            // sign out, change own PIN, read own session
  '/api/data',            // enforces its own per-role table allowlist
  '/api/config-status',
  '/api/activity-feed',
  '/api/notifications',
  '/api/courses',
  '/api/upload',
  '/api/assistant',
  '/api/dashboard',      // scoped inside: a marketer sees only their own figures
]

/** API prefix → the portals that grant it. Any one portal is enough. */
export const API_PORTALS: Record<string, string[]> = {
  '/api/leads':              ['leads', 'my_leads', 'pm_leads'],
  '/api/referrals':          ['leads', 'my_leads'],
  '/api/conversions':        ['leads', 'my_leads'],
  '/api/pm':                 ['pm_leads'],
  '/api/marketer':           ['my_leads', 'my_earnings', 'my_link', 'marketers'],
  '/api/marketers':          ['marketers'],

  '/api/admissions':         ['admissions'],
  '/api/admission':          ['admissions'],
  '/api/applications':       ['admissions', 'my_leads'],

  '/api/finance':            ['finance'],
  '/api/fees':               ['finance', 'my_payments'],
  '/api/paystack':           ['finance', 'my_payments'],
  '/api/payment-reminders':  ['finance', 'grp_automation'],
  '/api/registrations':      ['registrations', 'finance'],
  '/api/remuneration':       ['remuneration'],
  '/api/tiers':              ['remuneration', 'marketers'],

  '/api/classes':            ['academics', 'my_classes', 'attendance'],
  '/api/class-reminders':    ['academics', 'grp_automation'],
  '/api/certificates':       ['academics'],
  '/api/trainer':            ['my_classes'],
  '/api/attendance':         ['attendance', 'my_classes'],
  '/api/staff-attendance':   ['clock_in', 'workforce', 'staff'],

  '/api/documents':          ['documents'],
  '/api/broadcast':          ['broadcast'],
  '/api/links':              ['broadcast', 'my_links'],
  '/api/messages':           ['messages', 'conversations'],
  '/api/sms':                ['broadcast', 'messages'],
  // Read-only delivery diagnostics. Reachable by whoever runs the system as
  // well as whoever sends the messages: the person asked why a colleague
  // never got their text is usually not the person who sent it.
  '/api/sms/delivery':       ['broadcast', 'settings'],
  '/api/whatsapp':           ['wa_lines', 'conversations'],

  '/api/reports':            ['reports'],
  '/api/analytics':          ['insights', 'dashboard'],
  '/api/info-sessions':      ['grp_automation'],
  '/api/sequences':          ['grp_automation'],
  '/api/reminders':          ['grp_automation', 'my_leads'],
  '/api/prep':               ['prep'],

  '/api/content':            ['grp_socials'],
  '/api/social':             ['grp_socials'],
  '/api/flyers':             ['grp_socials', 'my_flyers'],
  '/api/facebook':           ['grp_socials', 'settings'],

  '/api/knowledge':          ['knowledge'],
  '/api/alumni':             ['alumni'],
  '/api/workforce':          ['workforce'],
  '/api/staff':              ['staff'],
}

/** Prefixes only a super admin may reach, whatever their portal list says. */
export const SUPER_ADMIN_ONLY: string[] = [
  '/api/admin',
  '/api/test',
]

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

/**
 * Decide whether a request to an API path is permitted for the given role and
 * resolved portal list. Unknown /api paths are refused rather than allowed —
 * a new endpoint has to be classified deliberately.
 */
export function canReachApi(
  pathname: string,
  role: string | undefined,
  portals: string[]
): boolean {
  if (role === 'super_admin') return true
  if (SUPER_ADMIN_ONLY.some(p => matches(pathname, p))) return false
  if (SHARED_API_PATHS.some(p => matches(pathname, p))) return true

  // Longest matching prefix wins, so /api/class-reminders is not decided by
  // a shorter, unrelated entry.
  const hit = Object.keys(API_PORTALS)
    .filter(p => matches(pathname, p))
    .sort((a, b) => b.length - a.length)[0]

  if (!hit) return false
  return API_PORTALS[hit].some(portal => portals.includes(portal))
}

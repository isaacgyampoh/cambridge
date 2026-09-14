import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { lookup } from '@/lib/db/lookup'
import { loadProgrammes } from '@/lib/chatbot/programme'
import { pickPromotion, type Promotion } from '@/lib/marketing/promotionRules'

/**
 * A staff member's permanent marketing link.
 *
 * ── THE IDENTITY IS THE ONE THAT ALREADY EXISTS ────────────────────────────
 *
 * profiles.marketer_code is TEXT UNIQUE, is already generated for every
 * marketer by /api/marketer/ensure-code, and already drives /apply/{code} and
 * /refer?m={code}. It is exactly "one stable, attributable identifier per
 * member of staff", which is what a marketing link needs.
 *
 * So there is no second marketer table, no slug column and no migration: /m
 * resolves the code the rest of the ERP already resolves. A staff member's
 * marketing link and their registration link name the same person because
 * they ARE the same identifier.
 */

/** Everything /m is allowed to know about a member of staff. */
export type PublicMarketer = {
  /** Their code — the public half of the identity, already in the URL. */
  code: string
  /** For "shared by". Never a role, never a phone number, never an id. */
  name: string
}

/**
 * Resolve a marketing link to the person who owns it.
 *
 * ── WHAT IS DELIBERATELY NOT SELECTED ──────────────────────────────────────
 *
 * Not `id`. The page never needs it — attribution happens when the form is
 * submitted, where /api/applications/submit resolves the code server-side
 * exactly as it does today — and a profile id on a public page is an internal
 * identifier handed to anybody who opens a link.
 *
 * Not role, phone, email or portals. None of it belongs on a page a stranger
 * can open, and selecting a column is how it ends up in a payload later.
 */
export async function loadMarketerByCode(code: string): Promise<PublicMarketer | null> {
  // A malformed code must not reach the database as a query.
  if (!code || code.length > 100) return null

  const sb = createServiceClient()
  const { row, failed } = await lookup(
    sb.from('profiles')
      .select('full_name, marketer_code, is_active')
      .eq('marketer_code', code)
      .maybeSingle(),
  )

  if (failed) {
    // Logged rather than swallowed: a link that is genuinely wrong and one
    // the database could not check must not look the same to whoever is
    // trying to work out why their campaign is not converting.
    console.error('[marketing] could not resolve link', code, '—', failed)
    return null
  }
  if (!row) return null

  /*
   * A deactivated member of staff's link stops working.
   *
   * They have left, or their access has been withdrawn. Leads arriving on
   * their code would be assigned to somebody who is not there to call
   * anybody — which looks to the enquirer like being ignored, and to the
   * centre like a lead that simply went cold.
   */
  if (row.is_active === false) return null

  return {
    code: row.marketer_code as string,
    name: (row.full_name as string) || 'Cambridge Center of Excellence',
  }
}

export type MarketingPage = {
  marketer: PublicMarketer
  /** Null when nothing is scheduled — the page then shows the programmes. */
  promotion: Promotion | null
  /** Everything on offer, for when there is no single current cohort. */
  programmes: Awaited<ReturnType<typeof loadProgrammes>> extends { ok: true; data: infer T }
    ? T
    : never
  /** True when the programme records could not be READ, as distinct from none. */
  programmesUnavailable: boolean
}

/**
 * Everything /m/{code} needs, from the sources the rest of the ERP uses.
 *
 * loadProgrammes is the same canonical loader behind the public front page
 * and the chatbot, so a fee shown here is the fee in `courses` — not a copy
 * of it. If it is ever wrong, it is wrong in one place for everybody, which
 * is the only kind of wrong that gets noticed and fixed.
 */
export async function loadMarketingPage(code: string): Promise<MarketingPage | null> {
  const marketer = await loadMarketerByCode(code)
  if (!marketer) return null

  const loaded = await loadProgrammes()

  if (!loaded.ok) {
    /*
     * The page still renders. Somebody has followed a link a member of staff
     * shared, and an error page would waste a real enquiry — so they get the
     * centre, the person who invited them, and a way to apply, without any
     * claim about programmes or prices that could not be read.
     */
    console.error('[marketing] programmes unavailable for', code, '—', loaded.error)
    return { marketer, promotion: null, programmes: [] as never, programmesUnavailable: true }
  }

  return {
    marketer,
    promotion: pickPromotion(loaded.data),
    programmes: loaded.data as never,
    programmesUnavailable: false,
  }
}

/**
 * Where the "Register" button goes.
 *
 * Straight into the EXISTING application flow on the existing code, so the
 * lead is created, de-duplicated and attributed by exactly the code that
 * handles every other registration. Nothing about leads is reimplemented
 * here.
 *
 * The UTM parameters are how a registration that came from a staff marketing
 * link is told apart from one that came from the same person's ordinary
 * registration link. /apply already reads them from the query string and
 * /api/applications/submit already stores them, so this needs no change at
 * either end — and `source` is left alone, because a marketer's link IS a
 * referral and inventing a new enum value would mean a database migration to
 * record something the UTM columns already say.
 */
export function registerHref(code: string, programmeName?: string | null): string {
  const params = new URLSearchParams({
    utm_source: 'marketing_link',
    utm_medium: 'staff_link',
    utm_content: code,
  })
  if (programmeName) params.set('utm_campaign', programmeName)
  return `/apply/${encodeURIComponent(code)}?${params.toString()}`
}

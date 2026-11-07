/*
 * No server-only imports, by design.
 *
 * The question "may this person be given a lead?" is asked in two places that
 * cannot share server code: the distributor, which runs on the server and
 * chooses a recipient, and the assignment screen, which runs in the browser
 * and offers a list of people to choose from. When those two disagree the
 * screen offers somebody the server will refuse, and the operator is told
 * "that person cannot receive leads" about a name the product itself put in
 * front of them.
 *
 * So the rule lives here, where both can import it and a test can exercise it
 * directly — the same arrangement as ./selection and ../integrations/
 * smsRecipient.
 */
import { resolvePortals } from '../access/portals.ts'

/**
 * The portal that means "leads are part of this person's work".
 *
 * Defined here rather than in ../data/policy because that module is
 * server-only and this rule is not. policy re-exports it, so there is still
 * one spelling of it in the product.
 */
export const LEADS_PORTAL = 'my_leads'

/**
 * Roles that are never a destination for a lead, whatever their portals say.
 *
 * ── WHY A ROLE LIST AT ALL ─────────────────────────────────────────────────
 *
 * Everything else about lead access derives from the `my_leads` portal, and
 * that is deliberate: one source of truth, granted or withdrawn per person
 * from the staff screen. These two are the exception because they are not
 * configuration mistakes waiting to be corrected — they are what the role
 * means.
 *
 *   super_admin  runs the system. A lead sitting on the owner's dashboard is
 *                a lead nobody is working.
 *
 *   trainer      teaches. Trainers carried `my_leads` in their defaults, so
 *                every trainer was in the distribution pool, was assigned
 *                leads, was texted about them, and counted towards the
 *                distribution percentages — which quietly took leads away
 *                from the people whose job is to convert them.
 *
 * A trainer whose profile already has an explicit portal list is covered too,
 * which a change to the defaults alone would not do: resolvePortals ignores
 * the role defaults entirely once somebody has been configured by hand, and
 * most long-serving staff have been.
 *
 * If one particular trainer really does work leads, the honest way to say so
 * is to change their role — not to leave a rule that says trainers are given
 * leads when the centre has decided they are not.
 */
export const NEVER_RECEIVES_LEADS: readonly string[] = ['super_admin', 'trainer']

export type LeadRecipient = {
  role: string | null | undefined
  /** The portals saved on the profile, if any. Null means "use the role's". */
  portals?: string[] | null
  /** False only when the profile is explicitly deactivated. */
  isActive?: boolean | null
  /** The per-person opt-out. Null means "never configured", which is not an opt-out. */
  inLeadPool?: boolean | null
}

/** May this person be given a lead? The whole rule, in one place. */
export function mayReceiveLeads(person: LeadRecipient): boolean {
  // Deactivated staff are not a destination for anything.
  if (person.isActive === false) return false

  // The roles the work does not belong to.
  if (NEVER_RECEIVES_LEADS.includes(String(person.role))) return false

  // An explicit opt-out always wins. NULL is not an opt-out: the column is
  // null for everybody never configured, and treating that as false emptied
  // the pool.
  if (person.inLeadPool === false) return false

  // And the decisive test: is this part of their work at all?
  return resolvePortals(person.role || undefined, person.portals).includes(LEADS_PORTAL)
}
